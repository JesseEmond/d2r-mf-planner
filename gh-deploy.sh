#!/bin/bash
set -e

python3 - << 'PYEOF'
import re, sys

text = open('public/js/changelog.js').read()
m = re.search(r'export\s+const\s+UNRELEASED\s*=\s*\[([^\]]*)\]', text, re.DOTALL)
if not m:
    print("ERROR: Could not find UNRELEASED array in public/js/changelog.js", file=sys.stderr)
    sys.exit(1)
content = re.sub(r'//[^\n]*', '', m.group(1)).strip().strip(',').strip()
if content:
    print("ERROR: changelog.js has unreleased entries — move them to a dated release before deploying.", file=sys.stderr)
    for line in content.splitlines():
        line = re.sub(r"^['\"\s,]+|['\"\s,]+$", '', line)
        if line:
            print(f"  · {line}", file=sys.stderr)
    sys.exit(1)
PYEOF

git subtree push --prefix public origin gh-pages
