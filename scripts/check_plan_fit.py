#!/usr/bin/env python3
"""Reports, for every page of plan.html, how many millimetres of content overflow.

Renders a debug copy in headless Chromium and reads back measured element heights,
so page breaks are checked with numbers instead of eyeballing previews.
"""
from __future__ import annotations

import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
SRC = ROOT / "docs" / "albertitos_plan" / "plan.html"
DEBUG = ROOT / "tmp" / "plan_fit.html"

PROBE = """
<script>
window.addEventListener('load', () => {
  const lines = [];
  document.querySelectorAll('.hoja').forEach((hoja, i) => {
    const last = hoja.lastElementChild;                    // .pie, or content if pushed out
    const limit = hoja.getBoundingClientRect().bottom;
    const bottom = last.getBoundingClientRect().bottom;
    const over = (bottom - limit) / 3.7795;                // px -> mm
    const slack = Array.from(hoja.children)
      .reduce((h, c) => h + c.getBoundingClientRect().height, 0);
    lines.push(`PAGE ${i + 1} over=${over.toFixed(1)}mm used=${(slack / 3.7795).toFixed(0)}mm`);
  });
  const pre = document.createElement('pre');
  pre.id = 'fitreport';
  pre.textContent = lines.join('\\n');
  document.body.appendChild(pre);
});
</script>
"""


def main() -> int:
    browser = next(
        (b for b in ("chromium", "chromium-browser", "google-chrome") if shutil.which(b)), None
    )
    if not browser:
        print("no chromium found", file=sys.stderr)
        return 1

    DEBUG.parent.mkdir(parents=True, exist_ok=True)
    DEBUG.write_text(SRC.read_text(encoding="utf-8").replace("</body>", PROBE + "</body>"), encoding="utf-8")

    dom = subprocess.run(
        [browser, "--headless", "--disable-gpu", "--virtual-time-budget=4000",
         "--dump-dom", f"file://{DEBUG}"],
        capture_output=True, text=True, check=True,
    ).stdout

    report = re.search(r'<pre id="fitreport">(.*?)</pre>', dom, re.S)
    if not report:
        print("no measurements returned", file=sys.stderr)
        return 1

    bad = 0
    for line in report.group(1).strip().splitlines():
        over = float(re.search(r"over=(-?[\d.]+)mm", line).group(1))
        flag = "  <-- SE SALE" if over > 0.2 else ""
        bad += over > 0.2
        print(line + flag)
    print(f"\n{bad} página(s) con desbordamiento")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
