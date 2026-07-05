#!/usr/bin/env python3
"""
Prints rune trade values from the latest (or a specific) trade snapshot.

For each rune from Pul to Zod, shows:
  • Its market value in iv (Ist-value units)
  • The closest discrete rune combination that approximates that value,
    expressed using other runes only (the rune itself is excluded)

Usage:
    python scripts/show_rune_values.py
    python scripts/show_rune_values.py --date 2026-07-05
"""

import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))

from trade_snapshots import (
    combo_iv_value,
    find_best_rune_combo,
    format_rune_combo,
    get_all_ist_values,
    load_latest_snapshot,
)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--date", metavar="YYYY-MM-DD",
                        help="Snapshot date to load (default: latest)")
    args = parser.parse_args()

    snapshot = load_latest_snapshot(args.date)
    values = get_all_ist_values(snapshot)

    if not values:
        print("No iv values found in snapshot — check that fetch_trade_snapshot.py succeeded.")
        sys.exit(1)

    sorted_runes = sorted(values, key=lambda r: values[r], reverse=True)
    cheapest_rune = min(values, key=lambda r: values[r])

    snapshot_date = snapshot.get("date", "unknown")
    print(f"\nRune trade values — snapshot {snapshot_date}")
    print(f"{'Rune':<6}  {'iv value':>9}  {'Closest combo (excl. self)':<34}  {'Combo iv':>9}  {'Diff':>7}")
    print("-" * 74)

    for rune in sorted_runes:
        iv_val = values[rune]
        if rune == cheapest_rune:
            # No cheaper runes exist to express this value — show it as itself.
            combo = [rune]
        else:
            combo = find_best_rune_combo(iv_val, snapshot, exclude=rune)
        combo_iv = combo_iv_value(combo, snapshot)
        diff = combo_iv - iv_val
        diff_str = f"{diff:+.2f}" if combo else "n/a"

        print(
            f"{rune:<6}  {iv_val:>9.2f}  {format_rune_combo(combo):<34}  "
            f"{combo_iv:>9.2f}  {diff_str:>7}"
        )

    print()
    print("iv = Ist-value units (typical market price relative to 1 Ist Rune).")
    print("Ist itself may be > 1.00 iv when demand is elevated.")
    print("'Diff' = combo iv − rune iv (positive = slight overpay, negative = underpay).")


if __name__ == "__main__":
    main()
