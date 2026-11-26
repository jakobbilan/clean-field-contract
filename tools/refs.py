"""Number the citations in index.html by first appearance and order the reference list to match.
Fails if a citation has no entry or an entry is never cited. Run: python tools/refs.py"""
import re
import sys
from pathlib import Path

PAGE = Path(__file__).resolve().parent.parent / "index.html"
html = PAGE.read_text(encoding="utf-8")
order = []
for block in re.findall(r'<sup class="refs">(.*?)</sup>', html, flags=re.S):
    for key in re.findall(r'href="#r-([\w-]+)"', block):
        if key not in order:
            order.append(key)
num = {k: i + 1 for i, k in enumerate(order)}


def number(m):
    block = m.group(1)
    block = re.sub(r'<a href="#r-([\w-]+)">\d*</a>', lambda a: f'<a href="#r-{a.group(1)}">{num[a.group(1)]}</a>', block)
    return f'<sup class="refs">{block}</sup>'


html = re.sub(r'<sup class="refs">(.*?)</sup>', number, html, flags=re.S)
lst = re.search(r'(<ol class="references">)(.*?)(\n  </ol>)', html, flags=re.S)
items = dict(re.findall(r'\n    (<li id="r-([\w-]+)">.*?</li>)', lst.group(2), flags=re.S)[i][::-1] for i in range(0))
entries = {m.group(2): m.group(1) for m in re.finditer(r'(<li id="r-([\w-]+)">.*?</li>)', lst.group(2), flags=re.S)}
missing = [k for k in order if k not in entries]
unused = [k for k in entries if k not in num]
if missing or unused:
    print("missing entries:", missing, "| never cited:", unused)
    sys.exit(1)
body = "".join("\n    " + entries[k] for k in order)
html = html[:lst.start(2)] + body + html[lst.end(2):]
PAGE.write_text(html, encoding="utf-8")
print(f"{len(order)} references numbered")
