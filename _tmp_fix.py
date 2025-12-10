from pathlib import Path
import re
path = Path('calendar/calendar.css')
text = path.read_text()
def replace_block(selector, new_value):
    pattern = rf"({re.escape(selector)}\s*{{[^}}]*?z-index:\s*)(\d+)"
    def repl(match):
        return f"{match.group(1)}{new_value}"
    new_text, count = re.subn(pattern, repl, text, count=1, flags=re.S)
    if count == 0:
        raise SystemExit(f"Failed to find z-index for {selector}")
    return new_text

replacements = {
    '.footer-track': '40',
    '.footer-text': '44',
    '.footer-robot': '45',
    '.snow-drift': '42',
    '.lights': '200',
}
for selector, value in replacements.items():
    text = re.sub(rf"({re.escape(selector)}\s*{{[^}}]*?z-index:\s*)(\d+)",
                  lambda m, val=value: m.group(1) + val,
                  text, count=1, flags=re.S)
path.write_text(text)
