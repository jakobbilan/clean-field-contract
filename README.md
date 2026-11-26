# The Clean Field Contract

A policy brief, published as a single web page, on paying Punjab’s farmers for paddy fields left unburnt.
By Elchin Abbasov, Jakob Bilan, Timeo Goncalves, Narmin Isgandarli, Jack King, Ann Mary Philip and Cosimo Zatti
(School of Public Policy, LSE).

Plain HTML, CSS and JavaScript served by GitHub Pages. A small Python pipeline refreshes the satellite fire
data every day during the burning season and fetches the satellite images, the photograph and the wind data.

## Publish it

1. Create a new public repository on GitHub, for example `clean-field-contract`, with no README.
2. Upload the contents of this folder to the repository root, so that `index.html` sits at the top level.
   Include the hidden `.github` folder (it holds the workflow) and the `.nojekyll` file. On a Mac, press
   Cmd+Shift+. in Finder to show hidden files before selecting everything.
3. Settings, Pages, Build and deployment, Source: choose **GitHub Actions**. The upload in step 2 starts the
   workflow "Build and publish", which deploys the page to `https://<user>.github.io/clean-field-contract/`.
4. Request a free map key from NASA FIRMS (https://firms.modaps.eosdis.nasa.gov/api/map_key/; an e-mail address
   is enough) and add it under Settings, Secrets and variables, Actions, as a repository secret named `FIRMS_MAP_KEY`.
5. Actions, Build and publish, Run workflow. This run downloads three NASA satellite images, the photograph, ten
   seasons of hourly wind and three seasons of fire detections, commits them and redeploys the page. After that
   the workflow runs every day from September to December.

Before step 5 the page shows its vector map, the north-west wind sector and the official figures. If the data
step fails, the deploy step still publishes the page as it is; the log under Actions shows which source failed.
GitHub pauses scheduled workflows in public repositories after 60 days without activity; re-enable the workflow
under Actions before the next season.

To look at it locally: `python3 -m http.server 8000`, then open http://localhost:8000.

## What is on the page

| Part | What it does |
| --- | --- |
| Map story | Scrolls from South Asia to Punjab, the six districts that cause about 40% of India’s crop-smoke deaths, and a single field. Fire detections play forward day by day as you scroll. |
| Wind | Evenly spaced, moving streamlines of the season-mean wind 50 m above ground (NASA POWER, MERRA-2, 15 October to 30 November 2016–2025). Until the data are downloaded, the lines show the prevailing north-westerly flow and are labelled as schematic. |
| Imagery | VIIRS (11 November 2021) for the overview steps, MODIS at 250 m for the Punjab steps with fire dots on top, and a 30 m HLS image of burn scars for the field step, chosen automatically as the clearest recent date. |
| Figures 1 to 4 | Counted fires against mapped burnt area; the timing of burning against satellite passes; the price of clearing a field without fire; the results of the Punjab trial |
| Figure 5 | Calculator: what a farmer with a given number of acres would receive |
| Figure 7 | Explorer: acres no longer burnt, deaths averted and public money at any assumed effect |
| Figure 8 | Delivery calendar from notification to the first final payments |
| Sharing | WhatsApp and e-mail links, copy link, and a print layout that turns the page into a printable brief |

## Verification

`data/claims-register.csv` lists every number and finding on the page with its source, the page or table it
comes from, the type of evidence and when it was checked (26 November 2026). Figure 3 and the baler figure are
recomputed from the CEEW survey microdata; the cost figures are taken from the group’s cost-benefit note.

## Layout

| Path | Contents |
| --- | --- |
| `index.html` | All text, figure slots and the numbered reference list |
| `css/site.css` | Type, colour tokens (light and dark), layout, print styles |
| `js/site.js` | Map story, data loading, charts, calculator, explorer, sharing |
| `js/data.js` | Every number behind the figures, each with its source key |
| `js/geo.js` | District and state boundaries, coast and rivers (TopoJSON) |
| `js/india.js` | India’s national boundary and state lines (GeoJSON, simplified) |
| `data/figures/` | CSV files behind Figures 1, 3 and 4 |
| `data/claims-register.csv` | Source, locator and check date for every claim on the page |
| `data/*.json` | Written by the pipeline: `assets.json`, `wind.json`, `live.json`, `fires-<season>.json` |
| `assets/` | Satellite images and the photograph, downloaded by the pipeline |
| `pipeline/` | Python, standard library only, with offline tests |
| `tools/refs.py` | Numbers citations by first appearance and orders the reference list; fails on a missing entry |
| `tools/figures.mjs` | Rewrites the CSV files from `js/data.js` |
| `vendor/`, `fonts/` | D3 7.9.0, topojson-client 3.1.0, STIX Two Text and Fira Sans, with licences |

## Editing

- Text: edit `index.html`. Cite with `<sup class="refs"><a href="#r-key"></a></sup>`, add `<li id="r-key">…</li>`
  to the reference list, then run `python3 tools/refs.py`.
- Numbers: edit `js/data.js`, then run `node tools/figures.mjs`.
- Sources, places and dates used by the pipeline: `pipeline/config.py`.

## The pipeline

`python -m pipeline.build` (`--refresh` downloads everything again; `--offline` rebuilds from saved files).

- Fire detections: NASA FIRMS area API, VIIRS on NOAA-20, five days per request; standard-processing data for
  seasons that ended at least 100 days ago, near-real-time data otherwise. Kept: points inside Punjab’s districts,
  15 September to 30 November in India time, nominal or high confidence, no duplicates.
- Wind: NASA POWER regional daily API, U50M and V50M, four tiles of at most 4.5 degrees, 15 October to 30 November
  2016–2025, averaged per grid cell into `data/windfield.json`.
- Field image: NASA GIBS WMS, HLS S30 and L30 true colour; small previews of each date are scored by JPEG size and
  the best date is downloaded at 2048 px (`data/field-image.json`).
- Satellite images: NASA GIBS WMS, VIIRS on Suomi NPP and MODIS on Terra true colour, 11 November 2021, the day
  NASA’s Earth Observatory showed smoke streaming from Punjab towards Delhi.
- Photograph: Wikimedia Commons, Neil Palmer (CIAT), CC BY-SA 2.0.

Checks run before a file is replaced: points inside Punjab’s box, days and times in range, counts that match
the rows, cumulative series that never fall, no refresh that loses more than 10% of a season, and wind shares
that cover at least 80% of the expected hours and sum to one. `python -m pytest -q pipeline/tests` runs offline.
The live services could not be reached from where this was built, so check the first workflow run.

## Caveats

- FIRMS detections are raw detections by one satellite, not Punjab’s official count; the page says so.
- The satellite image is from 2021; fire detections are from the seasons named on the map.
- The boundaries have 22 districts; Malerkotla, created in 2021, is shown within Sangrur.
- Every public source on the page has a link. The group’s design notes and cost model are unpublished course documents.

## Licences

Boundaries: INDIAN-SHAPEFILES by datta07 (MIT). Coast and rivers: Natural Earth (public domain). Fire data:
NASA FIRMS. Wind: NASA POWER. Imagery: NASA GIBS. Photograph: Neil Palmer (CIAT), CC BY-SA 2.0. D3 and
topojson-client: ISC. STIX Two Text and Fira Sans: SIL Open Font Licence 1.1. Text: the authors.
