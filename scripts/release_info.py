#!/usr/bin/env python3
"""Prints context for the /release command: unreleased changelog entries,
commits since the last gh-pages deploy, and the most recent release entry.

Reads public/js/changelog.js and git history. Read-only; does not modify anything.
"""
import re
import subprocess
import sys

CHANGELOG_PATH = "public/js/changelog.js"


def _strip_line(line: str) -> str:
    return re.sub(r"^['\"\s,]+|['\"\s,]+$", "", line)


def print_unreleased() -> None:
    text = open(CHANGELOG_PATH).read()
    m = re.search(r"export\s+const\s+UNRELEASED\s*=\s*\[([^\]]*)\]", text, re.DOTALL)
    content = re.sub(r"//[^\n]*", "", m.group(1)).strip() if m else ""
    lines = [_strip_line(l) for l in content.splitlines()]
    lines = [l for l in lines if l]
    print("\n".join(f"  - {l}" for l in lines) if lines else "  (none)")


def print_commits_since_deploy() -> None:
    main_log = subprocess.check_output(["git", "log", "--format=%s", "main"]).decode().strip().splitlines()
    gh_last = subprocess.check_output(["git", "log", "--format=%s", "origin/gh-pages", "-1"]).decode().strip()
    try:
        idx = main_log.index(gh_last)
        new_msgs = main_log[:idx]
    except ValueError:
        new_msgs = main_log
    print("\n".join(f"  - {m}" for m in new_msgs) if new_msgs else "  (none — already up to date)")


def print_last_release() -> None:
    text = open(CHANGELOG_PATH).read()
    m = re.search(r"date:\s*['\"]([\d-]+)['\"]\s*,\s*changes:\s*\[([^\]]*)\]", text, re.DOTALL)
    if not m:
        print("  (none found)")
        return
    date = m.group(1)
    lines = [_strip_line(l) for l in m.group(2).splitlines()]
    lines = [l for l in lines if l and not l.startswith("//")]
    print(f"  {date}")
    print("\n".join(f"  - {l}" for l in lines))


COMMANDS = {
    "unreleased": print_unreleased,
    "commits": print_commits_since_deploy,
    "last-release": print_last_release,
}

if __name__ == "__main__":
    if len(sys.argv) != 2 or sys.argv[1] not in COMMANDS:
        print(f"usage: release_info.py [{'|'.join(COMMANDS)}]", file=sys.stderr)
        sys.exit(1)
    COMMANDS[sys.argv[1]]()
