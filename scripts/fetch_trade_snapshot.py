#!/usr/bin/env python3
"""
Fetches rune and target gear item trade prices from Traderie, saves a dated snapshot.

Traderie requires two things from browser DevTools → Network → any
traderie.com API request → right-click → Copy → Copy as cURL:

  --token   value of the 'authorization' header (everything after 'Bearer ')
  --cookie  value after '-b ' in the cURL command

Usage:
    python scripts/fetch_trade_snapshot.py --token "eyJ..." --cookie "cf_clearance=...; ..."
    python scripts/fetch_trade_snapshot.py --token-file ~/.traderie_token --cookie-file ~/.traderie_cookie
    TRADERIE_TOKEN="eyJ..." TRADERIE_COOKIE="..." python scripts/fetch_trade_snapshot.py

    # First run: discover and cache Traderie item IDs for runes + gear items
    python scripts/fetch_trade_snapshot.py --token "..." --cookie "..." --discover-ids

Output:
    data/trade_snapshots/snapshot-YYYY-MM-DD.json  (price snapshot)
    data/trade_snapshots/item_ids.json              (cached item IDs, auto-updated)
"""

import argparse
import json
import os
import sys
import time
from dataclasses import dataclass, field
from datetime import date
from pathlib import Path

import requests

# Make sibling scripts importable.
sys.path.insert(0, str(Path(__file__).parent))
import extract_gear_stats

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
_THROTTLE_SECONDS = 3.0
_BATCH_SIZE = 4
_BATCH_PAUSE_SECONDS = 8.0


@dataclass
class GearItemException:
    # Override the Traderie search term (default: use the item name as-is).
    search_term: str | None = None
    # If set, skip this item during fetch and log this message instead of fetching.
    skip_reason: str | None = None
    # Additional prop_* params appended to the price-check request (for stat filtering).
    extra_params: dict = field(default_factory=dict)


# Exceptions for preset items whose name doesn't map 1-to-1 to a Traderie search,
# or that need special handling.  Items not listed here are searched by name directly;
# if their ID cannot be found, the script fails and prompts adding an exception.
GEAR_ITEM_EXCEPTIONS: dict[str, GearItemException] = {
    # Rune already priced in the runes section.
    "Ist": GearItemException(
        skip_reason="SKIP: rune — already priced in the runes section",
    ),
    # TODO: runewords have no single canonical Traderie item ID (value varies by base).
    "Spirit": GearItemException(
        skip_reason="TODO: runeword — figure out if Traderie has a canonical Spirit entry or derive from rune prices",
    ),
    # TODO: Hellfire Torch on Traderie is per-class; needs prop_Class=Sorceress filter,
    # and non-perfect (< 20/20 resist rolls) should be priced separately from perfect.
    "Sorc Torch": GearItemException(
        search_term="Hellfire Torch",
        skip_reason=(
            "TODO: needs prop_Class=Sorceress and non-perfect stat filtering "
            "(prop_Max Fire Resist<20) — perfect vs non-perfect have very different prices"
        ),
    ),
    # TODO: latent cold (cold-absorb roll) drives value; confirm Traderie prop_* key
    # by inspecting a live listing before implementing the filter.
    "Cold Rupture (MF)": GearItemException(
        search_term="Cold Rupture",
        skip_reason=(
            "TODO: needs latent-cold stat filtering — "
            "confirm Traderie prop_* key for cold absorb roll by inspecting a live listing"
        ),
    ),
    # TODO: magic Grand Charm — figure out if Traderie exposes a search for +1 cold skills GCs.
    "+1 Cold Sorc Skiller": GearItemException(
        skip_reason="TODO: magic Grand Charm — figure out Traderie search / prop filtering for skillers",
    ),
    # TODO: Cold Facet search returns all facets; need prop_* filter for +5/+5 roll specifically.
    "Cold Facet (+5/-5)": GearItemException(
        search_term="Cold Facet",
        skip_reason="TODO: needs prop_* filtering for +5/+5 roll — confirm exact Traderie property names",
    ),
    # TODO: rare items have no unique Traderie item ID; figure out how to price rares.
    "Rare MF Boots": GearItemException(
        skip_reason="TODO: rare item — figure out how to price rares on Traderie",
    ),
    "Rare MF Ring": GearItemException(
        skip_reason="TODO: rare item — figure out how to price rares on Traderie",
    ),
    # TODO: magic Small Charm with 7% MF — figure out Traderie prop filtering for magic SCs.
    "7% MF SC": GearItemException(
        skip_reason="TODO: magic Small Charm — figure out Traderie search / prop filtering for magic SCs",
    ),
}


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


def _search_item_id(session: requests.Session, search: str) -> int | None:
    """Search Traderie for an item by name and return its ID, or None if not found."""
    resp = session.get(f"{TRADERIE_BASE}/items", params={"search": search, "limit": 10}, timeout=15)
    resp.raise_for_status()
    data = resp.json()
    items = data if isinstance(data, list) else data.get("items", data.get("data", []))
    for item in items:
        name = (item.get("name") or "").strip().lower()
        if name == search.lower():
            return item["id"]
    return None


def _discover_item_ids(
    session: requests.Session,
    known_ids: dict[str, int],
    skip_runes: bool = False,
) -> dict[str, int]:
    """Query Traderie to discover item IDs for runes and fetchable gear items.

    Items already present in known_ids are skipped.
    """
    ids: dict[str, int] = {}
    fetchable_gear = [
        item for item in extract_gear_stats.get_preset_items()
        if not (GEAR_ITEM_EXCEPTIONS.get(item.name) or GearItemException()).skip_reason
    ]
    rune_targets = [] if skip_runes else [(rune, f"{rune} Rune") for rune in RUNES_PUL_PLUS]
    targets = (
        rune_targets
        + [(item.name, (GEAR_ITEM_EXCEPTIONS.get(item.name) or GearItemException()).search_term or item.display_name)
           for item in fetchable_gear]
    )
    targets = [(name, search) for name, search in targets if name not in known_ids]
    if not targets:
        print("  All item IDs already cached — nothing to discover.")
        return ids

    for i, (name, search) in enumerate(targets):
        print(f"  Searching for '{search}'...", end=" ", flush=True)
        try:
            found_id = _search_item_id(session, search)
        except requests.HTTPError as e:
            print(f"HTTP {e.response.status_code} — skipping")
            if i < len(targets) - 1:
                time.sleep(_THROTTLE_SECONDS)
            continue

        if found_id is not None:
            ids[name] = found_id
            print(f"id={found_id}")
        else:
            print("NOT FOUND — check response format or add a search_term override in GEAR_ITEM_EXCEPTIONS")

        if i < len(targets) - 1:
            time.sleep(_THROTTLE_SECONDS)
        if (i + 1) % _BATCH_SIZE == 0 and i < len(targets) - 1:
            print(f"  [batch pause {_BATCH_PAUSE_SECONDS}s]")
            time.sleep(_BATCH_PAUSE_SECONDS)

    return ids


def _fetch_price_check(session: requests.Session, item_id: int,
                       extra_params: dict | None = None) -> dict:
    params = {"item": item_id, **PRICE_CHECK_PARAMS, **(extra_params or {})}
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


def _fetch_items_section(
    label: str,
    items: list[str],
    item_ids: dict[str, int],
    session: requests.Session,
    exceptions: dict[str, GearItemException] | None = None,
    existing: dict | None = None,
    force: bool = False,
) -> dict:
    """Fetch price-check data for a list of named items; return snapshot section dict.

    For each item:
      - If already present in existing with no error and not skipped, carries it forward
        (unless force=True).
      - If it has a skip_reason in exceptions, records {skipped: True, reason: ...}.
      - If its ID is missing from item_ids, records {error: "missing item ID"}.
      - Otherwise fetches and records {item_id, tiers, raw_response}.

    Returns early (sys.exit) on auth errors.
    """
    exceptions = exceptions or {}
    existing = existing or {}
    section: dict = {}
    print(f"\nFetching price-check data for {len(items)} {label}...")

    for i, name in enumerate(items):
        exc = exceptions.get(name) or GearItemException()
        print(f"  {name:<40}", end=" ", flush=True)

        prior = existing.get(name)
        if not force and prior and "error" not in prior and not prior.get("skipped"):
            print("already fetched today — skipping (use --force to refetch)")
            section[name] = prior
            continue

        if exc.skip_reason:
            print(f"SKIPPED — {exc.skip_reason}")
            section[name] = {"skipped": True, "reason": exc.skip_reason}
            continue

        if name not in item_ids:
            print("ERROR — no item ID cached; run --discover-ids or add a GEAR_ITEM_EXCEPTIONS entry")
            section[name] = {"error": "missing item ID"}
            continue

        try:
            raw = _fetch_price_check(session, item_ids[name], exc.extra_params or None)
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
            section[name] = {"item_id": item_ids[name], "tiers": tiers, "raw_response": raw}
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
            section[name] = {"item_id": item_ids[name], "error": str(e)}
        except Exception as e:
            print(f"ERROR — {e}")
            section[name] = {"item_id": item_ids.get(name), "error": str(e)}
        else:
            if i < len(items) - 1:
                time.sleep(_THROTTLE_SECONDS)
            if (i + 1) % _BATCH_SIZE == 0 and i < len(items) - 1:
                print(f"  [batch pause {_BATCH_PAUSE_SECONDS}s]")
                time.sleep(_BATCH_PAUSE_SECONDS)
            continue

        if i < len(items) - 1:
            time.sleep(_THROTTLE_SECONDS)

    return section


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
                        help="Query Traderie to discover and cache item IDs for runes and gear")
    parser.add_argument("--skip-runes", action="store_true",
                        help="Skip fetching rune prices (useful when iterating on gear item support)")
    parser.add_argument("--refetch-all", action="store_true",
                        help="Refetch all items even if already present in today's snapshot")
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
        print("Discovering Traderie item IDs for runes and gear items...")
        discovered = _discover_item_ids(session, known_ids=item_ids, skip_runes=args.skip_runes)
        item_ids.update(discovered)
        _save_item_ids(item_ids)

    # Validate rune IDs are present before proceeding (unless skipping runes).
    if not args.skip_runes:
        missing_runes = [r for r in RUNES_PUL_PLUS if r not in item_ids]
        if missing_runes:
            print(f"\nMissing item IDs for runes: {missing_runes}")
            print("Run with --discover-ids to fetch them from Traderie.")
            sys.exit(1)

    # Validate gear item IDs: every fetchable item must have a cached ID or an exception.
    preset_items = extract_gear_stats.get_preset_items()
    missing_gear = [
        item.name for item in preset_items
        if item.name not in item_ids
        and not (GEAR_ITEM_EXCEPTIONS.get(item.name) or GearItemException()).skip_reason
    ]
    if missing_gear:
        print(f"\nMissing item IDs for gear items: {missing_gear}")
        print(
            "Either run --discover-ids to fetch them, or add an entry to "
            "GEAR_ITEM_EXCEPTIONS with a skip_reason or custom search_term."
        )
        sys.exit(1)

    snapshot_date = args.date or date.today().isoformat()
    output_path = SNAPSHOTS_DIR / f"snapshot-{snapshot_date}.json"
    SNAPSHOTS_DIR.mkdir(parents=True, exist_ok=True)

    # Bootstrap from today's snapshot if it exists, so re-runs skip already-fetched items.
    existing_snapshot: dict = {}
    if output_path.exists() and not args.refetch_all:
        with open(output_path) as f:
            existing_snapshot = json.load(f)
        print(f"Bootstrapping from existing snapshot: {output_path}")

    snapshot: dict = {
        "date": snapshot_date,
        "filters": PRICE_CHECK_PARAMS,
        "runes": existing_snapshot.get("runes", {}),
        "gear_items": existing_snapshot.get("gear_items", {}),
    }

    if args.skip_runes:
        print("\nSkipping runes (--skip-runes).")
    else:
        snapshot["runes"] = _fetch_items_section(
            "runes", RUNES_PUL_PLUS, item_ids, session,
            existing=existing_snapshot.get("runes", {}), force=args.refetch_all,
        )
    snapshot["gear_items"] = _fetch_items_section(
        "gear items", [item.name for item in preset_items], item_ids, session,
        exceptions=GEAR_ITEM_EXCEPTIONS,
        existing=existing_snapshot.get("gear_items", {}), force=args.refetch_all,
    )

    with open(output_path, "w") as f:
        json.dump(snapshot, f, indent=2)

    gear_ok = sum(1 for v in snapshot["gear_items"].values()
                  if "error" not in v and not v.get("skipped"))
    gear_skipped = sum(1 for v in snapshot["gear_items"].values() if v.get("skipped"))
    print(f"\nSnapshot saved → {output_path}")
    if not args.skip_runes:
        rune_ok = sum(1 for v in snapshot["runes"].values() if "error" not in v)
        print(f"  Runes:      {rune_ok}/{len(RUNES_PUL_PLUS)} succeeded")
        if rune_ok < len(RUNES_PUL_PLUS):
            print("  Re-run after refreshing your browser cookies for any rune failures.")
    print(f"  Gear items: {gear_ok} fetched, {gear_skipped} skipped (see TODOs above)")


if __name__ == "__main__":
    main()
