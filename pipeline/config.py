"""Every source, area, date and file name the pipeline uses. Change values here, not in the code."""
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
GEO_DISTRICTS = ROOT / "geo" / "punjab-districts.geojson"
USER_AGENT = "clean-field-contract/1.0 (student policy project; site data pipeline)"

# NASA FIRMS area API: /api/area/csv/[MAP_KEY]/[SOURCE]/[west,south,east,north]/[DAY_RANGE]/[DATE]
FIRMS_AREA = "https://firms.modaps.eosdis.nasa.gov/api/area/csv/{key}/{source}/{area}/{days}/{date}"
MAX_DAY_RANGE = 5                      # days per request
SATELLITE = "NOAA-20"
SOURCE_NRT = "VIIRS_NOAA20_NRT"        # near real time, for the running season
SOURCE_SP = "VIIRS_NOAA20_SP"          # standard processing, about three months behind
SP_LAG_DAYS = 100                      # use SP once a season ended this many days ago
PUNJAB_BBOX = (73.80, 29.50, 77.00, 32.55)
SEASON_START = (9, 15)                 # 15 September, India time
SEASON_END = (11, 30)                  # 30 November, India time
SEASON_DAYS = 77
UPDATE_UNTIL = (12, 20)                # keep refreshing the running season until this date
SEASON_A = 2021                        # the first map season (official count 71,304)
SHRINK_TOLERANCE = 0.10                # refuse a refresh that loses more than 10% of a season's detections

# NASA GIBS, WMS 1.1.1 in EPSG:4326 (bounding box is west,south,east,north)
GIBS_WMS = "https://gibs.earthdata.nasa.gov/wms/epsg4326/best/wms.cgi"
SAT_LAYER = "VIIRS_SNPP_CorrectedReflectance_TrueColor"
SAT_DATE = "2021-11-11"                # NASA Earth Observatory, "A shot of smoke for Delhi"
SAT_SCENES = [
    {"id": "wide", "bounds": [60.0, 4.0, 100.0, 40.0], "width": 2000, "height": 1800},
    {"id": "plain", "bounds": [70.0, 25.5, 82.0, 34.5], "width": 2400, "height": 1800},
    {"id": "punjab", "bounds": [73.3, 29.2, 77.3, 32.8], "width": 2000, "height": 1800},
]

# Wikimedia Commons photo (CC BY-SA 2.0)
PHOTO = {
    "commons_file": "NP_India_burning1_(6314801805).jpg",
    "out": "assets/img/sangrur-2011-11-02.jpg",
    "credit": "Rice straw burning near Sangrur, 2 November 2011. Photo: Neil Palmer (CIAT), CC BY-SA 2.0, via Wikimedia Commons.",
    "page": "https://commons.wikimedia.org/wiki/File:NP_India_burning1_(6314801805).jpg",
    "licence": "https://creativecommons.org/licenses/by-sa/2.0/",
}

# NASA POWER, hourly wind at 50 m (MERRA-2); direction is where the wind comes from, degrees clockwise from north
POWER_HOURLY = "https://power.larc.nasa.gov/api/temporal/hourly/point"
WIND_POINT = (30.901, 75.8573)          # latitude, longitude: Ludhiana
WIND_PLACE = "Ludhiana"
WIND_YEARS = list(range(2016, 2026))
WIND_START = (10, 15)
WIND_END = (11, 30)
WIND_CALM = 0.5                         # m/s; slower hours are counted as calm
