#!/usr/bin/env python3
"""
Fetches trade-value items (>= Med tier) from Maxroll.gg and writes
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
MIN_TIER = "med"

# Original Sunder Charm names → Latent (droppable) versions introduced in patch 3.2.
# Maxroll still uses the old names; we remap them to match uniqueitems.txt display names.
NAME_FIXES = {
    "Cold Rupture":        "Latent Cold Rupture",
    "Flame Rift":          "Latent Flame Rift",
    "Crack of the Heavens":"Latent Crack of the Heavens",
    "Rotting Fissure":     "Latent Rotting Fissure",
    "Bone Break":          "Latent Bone Break",
    "Black Cleft":         "Latent Black Cleft",
}

# Items from Reign of the Warlock (2026) not yet on the Maxroll valuables page.
# Source: https://maxroll.gg/d2/items/new-items-in-reign-of-the-warlock
MANUAL_ADDITIONS = [
    # Unique Grimoires (Warlock off-hand)
    "Ars Al'Diabolos",
    "Ars Tor'Baalos",
    "Ars Dul'Mephistos",
    "Measured Wrath",
    # Other unique items
    "Dreadfang",
    "Bloodpact Shard",
    "Wraithstep",
    "Sling",
    "Opalvein",
    "Entropy Locket",
    "Gheed's Wager",
    "Hellwarden's Will",
    # Bane's Garments set — excluded, not valuable enough
    # "Bane's Oathmaker",
    # "Bane's Wraithskin",
    # "Bane's Authority",
    # Horazon's Splendor set
    "Horazon's Countenance",
    "Horazon's Dominion",
    "Horazon's Hold",
    "Horazon's Legacy",
    "Horazon's Secrets",
    # Latent Sunder Charms rated Low on Maxroll — included because they are
    # droppable GCs (cm3) with the same drop path as Gheed's Fortune, so any
    # run that can drop a Gheed's can drop these, and they have real trade value.
    "Latent Rotting Fissure",
    "Latent Black Cleft",
    # Colossal Ancient Jewels — excluded, not droppable in normal MF runs
    # "Defender's Bile",
    # "Guardian's Thunder",
    # "Protector's Frost",
    # "Defender's Fire",
    # "Protector's Stone",
    # "Guardian's Light",
]


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

    items = sorted({NAME_FIXES.get(i, i) for i in items} | set(MANUAL_ADDITIONS))
    print(f"  +{len(MANUAL_ADDITIONS)} manual additions → {len(items)} total")

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(items, indent=2))
    print(f"Wrote {len(items)} items → {OUT}")


if __name__ == "__main__":
    main()
