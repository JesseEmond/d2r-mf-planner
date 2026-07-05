"""
trade_snapshots.py — library for querying Traderie rune price snapshots.

Snapshots live in data/trade_snapshots/runes-YYYY-MM-DD.json and are produced
by scripts/fetch_trade_snapshot.py.  All IST values are floats representing
the "typical" trade price in Ist Runes.

Public API:
    load_latest_snapshot(date=None)                        -> snapshot dict
    get_ist_value(rune, snapshot)                          -> float | None
    get_all_ist_values(snapshot)                           -> dict[str, float]
    find_best_rune_combo(target_iv, snapshot, exclude)     -> list[str]
    combo_iv_value(combo, snapshot)                        -> float
    format_rune_combo(combo)                               -> str

Note on units: all values are in "iv" (Ist-value units) — the typical market
price expressed as a multiple of whatever 1 Ist Rune currently trades for.
Ist itself may be > 1.0 iv when demand is elevated.
"""

import json
from collections import Counter
from pathlib import Path
from typing import Optional

REPO_ROOT = Path(__file__).parent.parent
SNAPSHOTS_DIR = REPO_ROOT / "data" / "trade_snapshots"

# Canonical rune order, Pul through Zod (r21–r33), ascending game value.
RUNE_ORDER = ["Pul", "Um", "Mal", "Ist", "Gul", "Vex", "Ohm", "Lo", "Sur", "Ber", "Jah", "Cham", "Zod"]


# ---------------------------------------------------------------------------
# Loading snapshots
# ---------------------------------------------------------------------------

def load_latest_snapshot(date: Optional[str] = None) -> dict:
    """Load the most recent snapshot, or a specific one by YYYY-MM-DD date string."""
    if date:
        path = SNAPSHOTS_DIR / f"runes-{date}.json"
        if not path.exists():
            raise FileNotFoundError(f"No snapshot for date {date!r} at {path}")
    else:
        candidates = sorted(SNAPSHOTS_DIR.glob("runes-????-??-??.json"))
        if not candidates:
            raise FileNotFoundError(
                f"No rune snapshots found in {SNAPSHOTS_DIR}.\n"
                "Run scripts/fetch_trade_snapshot.py to create one."
            )
        path = candidates[-1]

    with open(path) as f:
        return json.load(f)


# ---------------------------------------------------------------------------
# IST value lookups
# ---------------------------------------------------------------------------

def get_ist_value(rune: str, snapshot: dict) -> Optional[float]:
    """Return the typical IST trade value of a rune from a snapshot, or None."""
    entry = snapshot.get("runes", {}).get(rune, {})
    if "error" in entry:
        return None
    return entry.get("tiers", {}).get("typical")


def get_all_ist_values(snapshot: dict) -> dict[str, float]:
    """Return {rune: typical_ist} for every rune with valid data in the snapshot."""
    return {
        rune: v
        for rune in RUNE_ORDER
        if (v := get_ist_value(rune, snapshot)) is not None
    }


# ---------------------------------------------------------------------------
# Closest rune combo search
# ---------------------------------------------------------------------------

_MAX_RUNES_IN_COMBO = 6  # prevents Ber → many Pul while allowing 2× Pul for Mal


def find_best_rune_combo(
    target_iv: float,
    snapshot: dict,
    exclude: Optional[str] = None,
) -> list[str]:
    """Find a combination of runes whose total iv value is closest to target_iv.

    Uses a depth-first search with count-descending order (most of the largest
    rune first) so results prefer fewer, larger runes — e.g. Zod + Lo rather
    than many Pul.  The total rune count is capped at _MAX_RUNES_IN_COMBO to
    prevent degenerate all-small-rune solutions for large targets.

    exclude: rune name to leave out of the pool (use when expressing a rune's
             value in terms of *other* runes — avoids trivial self-references).

    Returns a list of rune names (duplicates for multiple copies of the same rune).
    Returns an empty list if no iv values are available.
    """
    values = get_all_ist_values(snapshot)
    if exclude:
        values = {r: v for r, v in values.items() if r != exclude}
    if not values:
        return []

    runes_sorted = sorted(values, key=lambda r: values[r], reverse=True)

    best: dict = {"combo": [], "diff": target_iv}  # baseline: zero runes

    def dfs(idx: int, remaining: float, current: list[str]) -> None:
        diff = abs(remaining)
        if diff < best["diff"] or (
            diff == best["diff"] and len(current) < len(best["combo"])
        ):
            best["diff"] = diff
            best["combo"] = list(current)

        if diff == 0 or idx >= len(runes_sorted) or len(current) >= _MAX_RUNES_IN_COMBO:
            return

        rune = runes_sorted[idx]
        val = values[rune]
        max_count = min(
            int(abs(remaining) / val) + 1,  # +1 allows one overshoot step
            _MAX_RUNES_IN_COMBO - len(current),
        )

        # Descending: try using more of this rune before fewer — keeps combos
        # compact and biased toward larger runes.
        for count in range(max_count, -1, -1):
            new_remaining = remaining - count * val
            # Prune overshoots that can't beat the current best.
            if new_remaining < 0 and abs(new_remaining) > best["diff"]:
                continue
            dfs(idx + 1, new_remaining, current + [rune] * count)

    dfs(0, target_iv, [])
    return best["combo"]


def combo_iv_value(combo: list[str], snapshot: dict) -> float:
    """Sum the iv values of a rune combo."""
    values = get_all_ist_values(snapshot)
    return sum(values.get(r, 0.0) for r in combo)


def format_rune_combo(combo: list[str]) -> str:
    """Format a rune combo as a human-readable string, most valuable rune first.

    Example: 'Ber + Ist + 2× Pul'
    """
    if not combo:
        return "(none)"
    counts = Counter(combo)
    parts = []
    for rune in reversed(RUNE_ORDER):  # Zod → Pul (highest value first)
        if rune in counts:
            n = counts[rune]
            parts.append(f"{n}× {rune}" if n > 1 else rune)
    return " + ".join(parts)
