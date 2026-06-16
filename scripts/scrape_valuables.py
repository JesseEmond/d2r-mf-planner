#!/usr/bin/env python3
"""
Fetches trade-value items (>= Low tier) from Maxroll.gg and writes
data/valuables.json — a sorted JSON array of item names.
"""

import json
import sys
from pathlib import Path

import requests
from bs4 import BeautifulSoup

URL = "https://maxroll.gg/d2/items/valuable-unique-set-items"
OUT = Path(__file__).parent.parent / "data" / "valuables.json"

# Worst-to-best rank; MIN_TIER controls the cutoff (inclusive).
TIER_RANK = {"trash": 0, "none": 1, "low": 2, "med": 3, "high": 4}
MIN_TIER = "low"


def fetch(url: str) -> str:
    r = requests.get(
        url,
        headers={"User-Agent": "Mozilla/5.0 (compatible; d2-planner/1.0)"},
        timeout=30,
    )
    r.raise_for_status()
    return r.text


def _walk(node: object, out: list[dict]) -> None:
    """Recursively collect every dict from a nested JSON structure."""
    if isinstance(node, dict):
        out.append(node)
        for v in node.values():
            _walk(v, out)
    elif isinstance(node, list):
        for item in node:
            _walk(item, out)


def parse_next_data(html: str) -> list[str] | None:
    """Extract items from the Next.js __NEXT_DATA__ script tag."""
    soup = BeautifulSoup(html, "html.parser")
    tag = soup.find("script", id="__NEXT_DATA__")
    if not tag:
        return None

    objs: list[dict] = []
    _walk(json.loads(tag.string), objs)

    min_rank = TIER_RANK[MIN_TIER]
    names: set[str] = set()
    for obj in objs:
        raw_tier = (
            obj.get("value")
            or obj.get("tier")
            or obj.get("rating")
            or obj.get("tradeValue")
        )
        name = obj.get("name") or obj.get("title") or obj.get("item")
        if (
            isinstance(raw_tier, str)
            and isinstance(name, str)
            and TIER_RANK.get(raw_tier.lower(), -1) >= min_rank
        ):
            names.add(name.strip())

    return sorted(names) if names else None


def parse_html_table(html: str) -> list[str] | None:
    """Fallback: scrape <tr> rows looking for tier badges in any cell."""
    soup = BeautifulSoup(html, "html.parser")
    min_rank = TIER_RANK[MIN_TIER]
    names: list[str] = []

    for row in soup.find_all("tr"):
        cells = row.find_all(["td", "th"])
        for cell in cells:
            text = cell.get_text(strip=True).lower()
            if TIER_RANK.get(text, -1) >= min_rank:
                name = cells[0].get_text(strip=True)
                if name:
                    names.append(name)
                break

    return sorted(set(names)) if names else None


def main() -> None:
    print(f"Fetching {URL} ...")
    html = fetch(URL)

    items = parse_next_data(html)
    if items:
        print(f"  Parsed {len(items)} items via __NEXT_DATA__")
    else:
        print("  __NEXT_DATA__ parse missed; falling back to HTML table ...")
        items = parse_html_table(html)

    if not items:
        print("ERROR: could not extract items — inspect page structure", file=sys.stderr)
        sys.exit(1)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, indent=2))
    print(f"Wrote {len(items)} items → {OUT}")


if __name__ == "__main__":
    main()
