#!/usr/bin/env python3
"""Pre-commit smoke check for the static site (stdlib only).

Run from anywhere:  python tools/check.py
Verifies that
  1. every local reference (href/src/url()) in the site's HTML and CSS resolves to a file,
  2. every calendar year's JS-loaded paths (images/, messages/, games/) exist when the year is populated,
  3. nothing from calendar/*/private/ is tracked or staged.
Exit code 1 on any problem. For the visual check start the "web" server from .claude/launch.json.
"""
import re
import subprocess
import sys
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parent.parent
SKIP_DIRS = {".git", ".claude", "private", "node_modules", "TemplateData", "Build"}
REF_RE = re.compile(r"""(?:href|src)\s*=\s*["']([^"'#?][^"']*)["']|url\(\s*["']?([^"')]+)["']?\s*\)""", re.I)
KNOWN_EXTERNAL = ("/members/",)  # linked from index.html but not present in this repo
problems = []


def local_target(source: Path, ref: str):
    if ref.startswith(("data:", "http:", "https:", "//", "mailto:", "javascript:") + KNOWN_EXTERNAL):
        return None
    path = unquote(urlparse(ref).path)
    if not path:
        return None
    base = ROOT if path.startswith("/") else source.parent
    return (base / path.lstrip("/")).resolve()


def check_refs():
    files = [p for ext in ("*.html", "*.css") for p in ROOT.rglob(ext)
             if not SKIP_DIRS & set(p.relative_to(ROOT).parts)]
    for f in files:
        text = f.read_text(encoding="utf-8", errors="replace")
        for m in REF_RE.finditer(text):
            ref = m.group(1) or m.group(2)
            target = local_target(f, ref.strip())
            if target is None:
                continue
            if target.is_dir():
                target = target / "index.html"
            if not target.exists():
                problems.append(f"{f.relative_to(ROOT)}: missing '{ref}'")
    return len(files)


def check_years():
    for year in sorted((ROOT / "calendar").glob("[0-9][0-9][0-9][0-9]")):
        games = [d for d in (year / "games").glob("*") if d.is_dir()]
        if not games:
            print(f"  {year.name}: skeleton (no games yet), skipped content check")
            continue
        for day in range(1, 25):
            if not (year / "images" / f"{day}.json").exists():
                problems.append(f"calendar/{year.name}: missing images/{day}.json")
            if not (year / "games" / str(day)).is_dir():
                problems.append(f"calendar/{year.name}: missing games/{day}/")
        if not (year / "messages" / "finale.json").exists():
            problems.append(f"calendar/{year.name}: missing messages/finale.json")


def check_themes():
    for themes_js in sorted((ROOT / "calendar").glob("*/themes.js")):
        year = themes_js.parent
        text = themes_js.read_text(encoding="utf-8")
        found = re.findall(r'id:\s*"([^"]+)"\s*,\s*name:[^,]+,\s*startDay:\s*(\d+)', text)
        ids, starts = [i for i, _ in found], [int(d) for _, d in found]
        if not found or starts[0] != 1 or starts != sorted(set(starts)) or starts[-1] > 24:
            problems.append(f"{themes_js.relative_to(ROOT)}: themes must start at day 1 with ascending startDay <= 24")
        css = (year / "calendar.css").read_text(encoding="utf-8")
        for theme_id in ids:
            if f'[data-theme="{theme_id}"]' not in css:
                problems.append(f"{year.name}/calendar.css: no palette block for {theme_id}")


def check_private():
    out = subprocess.run(["git", "ls-files", "--cached", "calendar"], cwd=ROOT,
                         capture_output=True, text=True).stdout.splitlines()
    leaked = [p for p in out if "/private/" in p]
    if leaked:
        problems.append(f"private files are tracked/staged ({len(leaked)}), e.g. {leaked[0]}")


n = check_refs()
check_years()
check_themes()
check_private()
print(f"checked {n} html/css files")
if problems:
    print("\nFAILED:")
    print("\n".join(f"  - {p}" for p in problems))
    sys.exit(1)
print("OK")
