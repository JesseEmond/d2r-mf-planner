#!/usr/bin/env python3
"""
Fetches rune trade prices from Traderie and saves a dated snapshot.

Traderie requires two things from browser DevTools → Network → any
traderie.com API request → right-click → Copy → Copy as cURL:

  --token   value of the 'authorization' header (everything after 'Bearer ')
  --cookie  value after '-b ' in the cURL command

Usage:
    python scripts/fetch_trade_snapshot.py --token "eyJ..." --cookie "cf_clearance=...; ..."
    python scripts/fetch_trade_snapshot.py --token-file ~/.traderie_token --cookie-file ~/.traderie_cookie
    TRADERIE_TOKEN="eyJ..." TRADERIE_COOKIE="..." python scripts/fetch_trade_snapshot.py

    # First run: discover and cache Traderie item IDs for each rune
    python scripts/fetch_trade_snapshot.py --token "..." --cookie "..." --discover-ids

Output:
    data/trade_snapshots/runes-YYYY-MM-DD.json   (price snapshot)
    data/trade_snapshots/item_ids.json            (cached item IDs, auto-updated)
"""

import argparse
import json
import os
import sys
import time
from datetime import date
from pathlib import Path

import requests

REPO_ROOT = Path(__file__).parent.parent
SNAPSHOTS_DIR = REPO_ROOT / "data" / "trade_snapshots"
ITEM_IDS_CACHE = SNAPSHOTS_DIR / "item_ids.json"

TRADERIE_BASE = "https://traderie.com/api/diablo2resurrected"

RUNES_PUL_PLUS = ["Pul", "Um", "Mal", "Ist", "Gul", "Vex", "Ohm", "Lo", "Sur", "Ber", "Jah", "Cham", "Zod"]

# Known item IDs from Traderie's database (populate via --discover-ids).
# Source: traderie.com/api/diablo2resurrected/items?search=<name>
KNOWN_ITEM_IDS: dict[str, int] = {
    "Ber": 4149485449,
}

PRICE_CHECK_PARAMS: dict[str, object] = {
    "limit": 100,
    "prop_Platform": "PC",
    "prop_Mode": "softcore",
    "prop_Ladder": "true",
    "prop_Game version": "reign of the warlock",
}

# Self-throttle to avoid hammering Traderie's backend.
_THROTTLE_SECONDS = 3.0   # pause between individual rune fetches
_BATCH_SIZE = 4           # pause after every N runes
_BATCH_PAUSE_SECONDS = 8.0


def _make_session(cookie: str, token: str) -> requests.Session:
    s = requests.Session()
    s.headers.update({
        "User-Agent": (
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
            "AppleWebKit/537.36 (KHTML, like Gecko) "
            "Chrome/125.0.0.0 Safari/537.36"
        ),
        "Accept": "application/json, text/plain, */*",
        "Accept-Language": "en-US,en;q=0.9",
        "Referer": "https://traderie.com/diablo2resurrected/trade",
        "Cookie": cookie,
        "Authorization": f"Bearer {token}",
    })
    return s


def _load_item_ids() -> dict[str, int]:
    ids = dict(KNOWN_ITEM_IDS)
    if ITEM_IDS_CACHE.exists():
        with open(ITEM_IDS_CACHE) as f:
            ids.update(json.load(f))
    return ids


def _save_item_ids(ids: dict[str, int]) -> None:
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)
    with open(ITEM_IDS_CACHE, "w") as f:
        json.dump(ids, f, indent=2, sort_keys=True)
    print(f"  Saved item ID cache → {ITEM_IDS_CACHE}")


def _discover_item_ids(session: requests.Session) -> dict[str, int]:
    """Query Traderie's items search endpoint to discover each rune's item ID."""
    ids: dict[str, int] = {}
    for i, rune in enumerate(RUNES_PUL_PLUS):
        search = f"{rune} Rune"
        print(f"  Searching for '{search}'...", end=" ", flush=True)
        resp = session.get(f"{TRADERIE_BASE}/items", params={"search": search, "limit": 10}, timeout=15)
        resp.raise_for_status()
        data = resp.json()

        # Response may be a list or a dict wrapping a list.
        items = data if isinstance(data, list) else data.get("items", data.get("data", []))
        matched = None
        for item in items:
            name = (item.get("name") or "").strip().lower()
            if name in (search.lower(), f"{rune.lower()} rune"):
                matched = item
                break

        if matched:
            ids[rune] = matched["id"]
            print(f"id={matched['id']}")
        else:
            print("NOT FOUND — check response format or search term")

        # Rate-limit
        if i < len(RUNES_PUL_PLUS) - 1:
            time.sleep(_THROTTLE_SECONDS)
        if (i + 1) % _BATCH_SIZE == 0 and i < len(RUNES_PUL_PLUS) - 1:
            print(f"  [batch pause {_BATCH_PAUSE_SECONDS}s]")
            time.sleep(_BATCH_PAUSE_SECONDS)

    return ids


def _fetch_price_check(session: requests.Session, item_id: int) -> dict:
    params = {"item": item_id, **PRICE_CHECK_PARAMS}
    resp = session.get(f"{TRADERIE_BASE}/items/price-check", params=params, timeout=30)
    resp.raise_for_status()
    return resp.json()


def _parse_price_tiers(raw: dict) -> dict[str, float | None]:
    """Extract floor/typical/good/high from a Traderie price-check response.

    Expected shape (as of API v1.3.0):
        {"percentiles": {"floor": X, "typical": Y, "good": Z, "high": W}, ...}
    """
    percentiles = raw.get("percentiles", {})
    return {
        tier: (float(v) if isinstance(v, (int, float)) else None)
        for tier in ("floor", "typical", "good", "high")
        for v in [percentiles.get(tier)]
    }


def main() -> None:
    parser = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    token_group = parser.add_mutually_exclusive_group()
    token_group.add_argument("--token", help="Bearer token from the Authorization header")
    token_group.add_argument("--token-file", metavar="FILE",
                             help="Path to a file containing the Bearer token")
    cookie_group = parser.add_mutually_exclusive_group()
    cookie_group.add_argument("--cookie", help="Cookie string (value after '-b ' in cURL)")
    cookie_group.add_argument("--cookie-file", metavar="FILE",
                              help="Path to a file containing the cookie string")
    parser.add_argument("--discover-ids", action="store_true",
                        help="Query Traderie to discover and cache rune item IDs")
    parser.add_argument("--date", metavar="YYYY-MM-DD",
                        help="Override snapshot date (default: today)")
    args = parser.parse_args()

    token = ""
    if args.token:
        token = args.token
    elif args.token_file:
        token = Path(args.token_file).read_text().strip()
    elif os.environ.get("TRADERIE_TOKEN"):
        token = os.environ["TRADERIE_TOKEN"]
    else:
        parser.error(
            "No token provided. Use --token, --token-file, or set TRADERIE_TOKEN.\n"
            "Get it from browser DevTools → Network → any traderie.com API request "
            "→ right-click → Copy → Copy as cURL → extract the value after 'Bearer ' "
            "in the -H 'authorization: Bearer ...' header."
        )

    cookie = ""
    if args.cookie:
        cookie = args.cookie
    elif args.cookie_file:
        cookie = Path(args.cookie_file).read_text().strip()
    elif os.environ.get("TRADERIE_COOKIE"):
        cookie = os.environ["TRADERIE_COOKIE"]
    # Cookie is optional (token is the real auth); omitting it is fine.

    session = _make_session(cookie, token)
    item_ids = _load_item_ids()

    if args.discover_ids:
        print("Discovering Traderie item IDs for runes...")
        discovered = _discover_item_ids(session)
        item_ids.update(discovered)
        _save_item_ids(item_ids)

    missing = [r for r in RUNES_PUL_PLUS if r not in item_ids]
    if missing:
        print(f"\nMissing item IDs for: {missing}")
        print("Run with --discover-ids to fetch them from Traderie.")
        sys.exit(1)

    snapshot_date = args.date or date.today().isoformat()
    output_path = SNAPSHOTS_DIR / f"runes-{snapshot_date}.json"
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    snapshot: dict = {
        "date": snapshot_date,
        "filters": PRICE_CHECK_PARAMS,
        "runes": {},
    }

    print(f"\nFetching price-check data for {len(RUNES_PUL_PLUS)} runes (date={snapshot_date})...")
    for i, rune in enumerate(RUNES_PUL_PLUS):
        print(f"  {rune:<5}", end=" ", flush=True)
        try:
            raw = _fetch_price_check(session, item_ids[rune])
            tiers = _parse_price_tiers(raw)
            if all(v is None for v in tiers.values()):
                print("PARSE ERROR — all tiers are None")
                print(f"  Raw keys: {list(raw.keys())}")
                print(f"  Raw (truncated): {json.dumps(raw)[:300]}")
                print("\nResponse format may have changed. Aborting.")
                sys.exit(1)
            print(
                f"floor={tiers.get('floor')}  typical={tiers.get('typical')}"
                f"  good={tiers.get('good')}  high={tiers.get('high')}"
            )
            snapshot["runes"][rune] = {
                "item_id": item_ids[rune],
                "tiers": tiers,
                "raw_response": raw,
            }
        except requests.HTTPError as e:
            status = e.response.status_code
            print(f"HTTP {status} — {e}")
            print(f"  Response body: {e.response.text[:500]}")
            if status in (401, 403):
                print(
                    "\nAuthentication error — your cookie has likely expired.\n"
                    "Refresh the cookie from browser DevTools and re-run."
                )
                sys.exit(1)
            # For other HTTP errors, record and continue.
            snapshot["runes"][rune] = {"item_id": item_ids[rune], "error": str(e)}
        except Exception as e:
            print(f"ERROR — {e}")
            snapshot["runes"][rune] = {"item_id": item_ids[rune], "error": str(e)}
        else:
            # Only throttle after a successful request; on error we already stopped or logged.
            if i < len(RUNES_PUL_PLUS) - 1:
                time.sleep(_THROTTLE_SECONDS)
            if (i + 1) % _BATCH_SIZE == 0 and i < len(RUNES_PUL_PLUS) - 1:
                print(f"  [batch pause {_BATCH_PAUSE_SECONDS}s]")
                time.sleep(_BATCH_PAUSE_SECONDS)
            continue

        # Non-auth error: still throttle before next attempt.
        if i < len(RUNES_PUL_PLUS) - 1:
            time.sleep(_THROTTLE_SECONDS)

    with open(output_path, "w") as f:
        json.dump(snapshot, f, indent=2)

    ok = sum(1 for v in snapshot["runes"].values() if "error" not in v)
    print(f"\nSnapshot saved → {output_path}  ({ok}/{len(RUNES_PUL_PLUS)} runes succeeded)")
    if ok < len(RUNES_PUL_PLUS):
        print("Re-run after refreshing your browser cookies for any failures.")


if __name__ == "__main__":
    main()
