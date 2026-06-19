#!/usr/bin/env python3
"""Tests for extract_gear_stats.py — focuses on the per-level property guard."""

import csv
import pytest
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent.parent))

from extract_gear_stats import _extract_stats, _assert_no_perlevel

RAW = Path(__file__).parent.parent.parent / "data" / "raw"


def _load_unique(name: str) -> dict:
    with open(RAW / "uniqueitems.txt", encoding="utf-8-sig", newline="") as f:
        for row in csv.DictReader(f, delimiter="\t"):
            if row.get("index", "").strip() == name:
                return row
    raise KeyError(f"'{name}' not found in uniqueitems.txt")


def test_skullder_trips_perlevel_guard():
    row = _load_unique("Skullder's Ire")
    with pytest.raises(NotImplementedError, match="mag%/lvl"):
        _extract_stats(row, item_name="Skullder's Ire")


def test_perlevel_untracked_prop_is_silent():
    # ac%/lvl is not a stat we track — should not raise
    row = {"prop1": "ac%/lvl", "par1": "", "min1": "", "max1": ""}
    _extract_stats(row, count=1, item_name="some item")


def test_empty_prop_is_silent():
    _assert_no_perlevel("", "any item")


def test_normal_mf_prop_is_silent():
    _assert_no_perlevel("mag%", "some item")
