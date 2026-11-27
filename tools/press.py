"""Builds the media pack in press/: key-message cards, figure images, map images, the one-page summary (PDF),
thumbnails for the page, a README and one ZIP with everything.

Run it on a copy of the site whose data/ and assets/ have been filled by the data workflow, so that maps and the
live figures show real data. Needs Python 3 with Playwright (Chromium) and Pillow:
    pip install playwright pillow && python -m playwright install chromium
    python tools/press.py
"""
import asyncio
import functools
import http.server
import json
import os
import socketserver
import sys
import threading
import zipfile
from pathlib import Path

from PIL import Image
from playwright.async_api import async_playwright

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else ".").resolve()
OUT = ROOT / "press"
CHROME = os.environ.get("CHROME")            # optional path to a Chromium binary
CREDIT = ("From: The Clean Field Contract, policy brief by Abbasov, Bilan, Goncalves, Isgandarli, King, Philip and Zatti, "
          "November 2026. jakobbilan.github.io/clean-field-contract")

CARDS = [(1, "01-punjab-share-of-smoke"), (2, "02-fire-counts"), (3, "03-timing-of-fires"),
         (4, "04-trial-result"), (5, "05-the-proposal"), (6, "06-what-has-to-happen")]
FIGURES = [("fig-counts", "figure-1-fire-counts-and-burnt-area"), ("fig-clock", "figure-2-timing-of-fires"),
           ("fig-costs", "figure-3-cost-of-alternatives"), ("fig-tried", "figure-4-what-has-been-tried"),
           ("fig-trial", "figure-5-trial-results"), ("fig-pay", "figure-7-who-pays"),
           ("fig-explorer", "figure-8-effect-at-10-points"), ("fig-route", "figure-9-route-to-statewide-payments")]

FIG_CSS = """
.chapter > * { max-width: 50rem !important; }
sup.refs, .data-link, .calc-row { display: none !important; }
.fig { margin: 0 !important; padding: 30px 34px 24px !important; background: #fff; }
.press-credit { font-family: var(--sans); font-size: 0.76rem; line-height: 1.45; color: var(--ink-3); margin-top: 14px; padding-top: 10px; border-top: 1px solid var(--rule-2); }
"""
MAP_CSS = """
.skip, .noscript { display: none !important; }
.scrolly { display: block !important; }
.stage { position: fixed !important; inset: 0 !important; width: 100vw !important; height: 100vh !important; z-index: 5; }
.steps { opacity: 0 !important; }
.press-cap { position: fixed; left: 28px; top: 28px; z-index: 9; max-width: 600px; background: rgba(255,255,255,0.94); padding: 18px 22px 16px; }
.press-cap .t { font-family: var(--serif); font-weight: 600; font-size: 1.55rem; line-height: 1.2; margin: 0 0 8px; }
.press-cap .s { font-family: var(--sans); font-size: 0.86rem; line-height: 1.45; color: var(--ink-2); margin: 0 0 8px; }
.press-cap .c { font-family: var(--sans); font-size: 0.74rem; line-height: 1.4; color: var(--ink-3); margin: 0; }
.stage .hud { top: 28px !important; right: 28px !important; }
"""


def serve(root):
    handler = functools.partial(http.server.SimpleHTTPRequestHandler, directory=str(root))
    handler.log_message = lambda *a: None
    httpd = socketserver.TCPServer(("127.0.0.1", 0), handler)
    threading.Thread(target=httpd.serve_forever, daemon=True).start()
    return httpd, f"http://127.0.0.1:{httpd.server_address[1]}"


def maps_spec():
    b = json.loads((ROOT / "data" / "fires-2026.json").read_text())
    a = json.loads((ROOT / "data" / "fires-2021.json").read_text())
    through = b.get("through", "2026-11-30")
    d = f"{int(through[8:10])} {['January','February','March','April','May','June','July','August','September','October','November','December'][int(through[5:7]) - 1]} {through[:4]}"
    return [
        (2, "map-1-smoke-and-wind", "Smoke from Punjab’s fields drifts towards Delhi",
         "Satellite image of 11 November 2021, VIIRS on Suomi NPP (NASA). Lines: average wind 50 m above the ground, "
         "15 October to 30 November 2016–2025 (NASA POWER, MERRA-2)."),
        (4, "map-2-fires-2021", "Fires detected in Punjab, 15 September to 30 November 2021",
         f"{a['count']:,} detections by VIIRS on NOAA-20 (NASA FIRMS) over a VIIRS image of 11 November 2021. "
         "The official count recorded 71,304 farm fires that season."),
        (6, "map-3-six-districts", "Six districts cause about 40% of the health damage from crop burning in India",
         "Barnala, Sangrur, Patiala, Moga, Ludhiana and Fatehgarh Sahib (Lan et al. 2022). Dots: fire detections from "
         f"15 September to {d} (VIIRS on NOAA-20, NASA FIRMS)."),
    ]


async def main():
    for sub in ("key-messages", "figures", "maps", "thumbs"):
        (OUT / sub).mkdir(parents=True, exist_ok=True)
    httpd, base = serve(ROOT)
    made = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(executable_path=CHROME, args=["--no-sandbox"]) if CHROME else await p.chromium.launch()
        # key-message cards
        page = await browser.new_page(viewport={"width": 1700, "height": 1500})
        for n, name in CARDS:
            for fmt, label in (("wide", "landscape"), ("tall", "portrait")):
                await page.goto(f"{base}/press/source/cards.html?n={n}&f={fmt}")
                await page.wait_for_selector("body[data-ready]")
                path = OUT / "key-messages" / f"{name}-{label}.png"
                await (await page.query_selector("#card")).screenshot(path=str(path))
                made.append(path)
        await page.close()
        # figures from the brief, at twice the screen resolution
        ctx = await browser.new_context(viewport={"width": 1300, "height": 900}, device_scale_factor=2)
        page = await ctx.new_page()
        await page.goto(f"{base}/index.html", wait_until="networkidle")
        await page.add_style_tag(content=FIG_CSS)
        await page.set_viewport_size({"width": 1302, "height": 900})
        await page.evaluate("document.fonts.ready")
        await page.wait_for_timeout(900)
        await page.evaluate("""(credit) => {
          const sub = document.querySelector('#fig-explorer .fig-sub');
          if (sub) sub.textContent = 'At an effect of 10 percentage points on the unburnt share of enrolled land. Figures are for one year once the scheme covers all of Punjab.';
          document.querySelectorAll('.fig').forEach(f => { if (!f.querySelector('.press-credit')) { const c = document.createElement('p'); c.className = 'press-credit'; c.textContent = credit; f.appendChild(c); } });
        }""", CREDIT)
        for fid, name in FIGURES:
            el = await page.query_selector(f"#{fid}")
            await el.scroll_into_view_if_needed()
            await page.wait_for_timeout(250)
            path = OUT / "figures" / f"{name}.png"
            await el.screenshot(path=str(path))
            made.append(path)
        await ctx.close()
        # maps, full screen, without the text column
        ctx = await browser.new_context(viewport={"width": 1600, "height": 900}, device_scale_factor=1, reduced_motion="reduce")
        page = await ctx.new_page()
        await page.goto(f"{base}/index.html", wait_until="networkidle")
        await page.add_style_tag(content=MAP_CSS)
        await page.evaluate("""() => { const d = document.createElement('div'); d.className = 'press-cap';
          d.innerHTML = '<p class="t"></p><p class="s"></p><p class="c"></p>'; document.body.appendChild(d); }""")
        await page.set_viewport_size({"width": 1601, "height": 900})
        await page.wait_for_timeout(500)
        for step, name, title, subtitle in maps_spec():
            await page.evaluate("""([t, s, c]) => { const d = document.querySelector('.press-cap');
              d.querySelector('.t').textContent = t; d.querySelector('.s').textContent = s; d.querySelector('.c').textContent = c; }""",
                                [title, subtitle, "The Clean Field Contract, policy brief, November 2026. jakobbilan.github.io/clean-field-contract"])
            await page.evaluate(f"document.querySelector('.step[data-step=\"{step}\"]').scrollIntoView({{block: 'center'}})")
            await page.wait_for_timeout(2600)
            path = OUT / "maps" / f"{name}.png"
            await page.screenshot(path=str(path))
            made.append(path)
        await ctx.close()
        # one-page summary
        page = await browser.new_page(viewport={"width": 794, "height": 1123})
        await page.goto(f"{base}/press/source/summary.html", wait_until="networkidle")
        await page.evaluate("document.fonts.ready")
        pdf = OUT / "clean-field-contract-summary.pdf"
        await page.pdf(path=str(pdf), format="A4", print_background=True, prefer_css_page_size=True)
        await page.screenshot(path=str(OUT / "thumbs" / "summary.png"))
        made.append(pdf)
        await page.close()
        await browser.close()
    httpd.shutdown()
    # thumbnails for the page
    for path in [m for m in made if m.suffix == ".png"] + [OUT / "thumbs" / "summary.png"]:
        im = Image.open(path).convert("RGB")
        w = 720 if "portrait" not in path.name else 420
        im = im.resize((w, round(im.height * w / im.width)), Image.LANCZOS)
        im.save(OUT / "thumbs" / (path.stem + ".jpg"), quality=84, optimize=True, progressive=True)
    (OUT / "thumbs" / "summary.png").unlink()
    write_readme()
    zip_path = OUT / "clean-field-contract-media-pack.zip"
    with zipfile.ZipFile(zip_path, "w", zipfile.ZIP_DEFLATED) as z:
        top = "clean-field-contract-media-pack/"
        z.write(OUT / "README.txt", top + "README.txt")
        for m in made:
            z.write(m, top + str(m.relative_to(OUT)))
        for csv in sorted((ROOT / "data" / "figures").glob("*.csv")):
            z.write(csv, top + "data/" + csv.name)
        z.write(ROOT / "data" / "claims-register.csv", top + "data/claims-register.csv")
    sizes = {str(m.relative_to(OUT)): m.stat().st_size for m in made + [zip_path]}
    (OUT / "sizes.json").write_text(json.dumps(sizes, indent=1))
    print(f"{len(made)} files and the ZIP ({zip_path.stat().st_size / 1e6:.1f} MB) written to {OUT}")


def write_readme():
    (OUT / "README.txt").write_text("""The Clean Field Contract: media pack

A proposal to pay Punjab's farmers for paddy fields left unburnt. Policy brief, November 2026, by Elchin Abbasov,
Jakob Bilan, Timeo Goncalves, Narmin Isgandarli, Jack King, Ann Mary Philip and Cosimo Zatti, School of Public
Policy, London School of Economics and Political Science. Full brief, sources and data:
https://jakobbilan.github.io/clean-field-contract/

Contents
  clean-field-contract-summary.pdf   One A4 page: the problem, the evidence, the proposal, costs and recommendations
  key-messages/                      Six messages, each as a landscape (1600 x 900) and a portrait (1080 x 1350) image
  figures/                           The brief's figures with titles, notes and sources, at twice screen resolution
  maps/                              Three maps (1600 x 900): smoke and wind, fires in 2021, the six districts
  data/                              The data behind Figures 1, 3 and 5, and a register of every figure's source

Reuse
  You may reuse these materials with credit. Suggested credit: "Abbasov et al. (2026), The Clean Field Contract,
  policy brief". Every figure and card names its sources; please keep them.
  Third-party material keeps its own terms: satellite images from NASA (GIBS, FIRMS, POWER); the 30 m image of
  burn scars contains modified Copernicus Sentinel data; the photograph used on the website is by Neil Palmer (CIAT),
  CC BY-SA 2.0, and is not part of this pack.

Suggested citation
  Abbasov, E., Bilan, J., Goncalves, T., Isgandarli, N., King, J., Philip, A. M. and Zatti, C. (2026). The Clean
  Field Contract: a proposal to pay Punjab's farmers for paddy fields left unburnt. Policy brief, November 2026.

The views are the authors' own and not those of LSE or of any government.
""", encoding="utf-8")


if __name__ == "__main__":
    asyncio.run(main())
