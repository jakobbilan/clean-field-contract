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
MODIS_LAYER = "MODIS_Terra_CorrectedReflectance_TrueColor"
BLUE_MARBLE = "BlueMarble_NextGeneration"     # static, cloud-free MODIS composite (2004); no date
SAT_SCENES = [                                 # group decides which map steps show the image; scenes are larger than any view
    {"id": "bm-wide", "group": "bm", "layer": BLUE_MARBLE, "date": None, "bounds": [40.0, -12.0, 125.0, 50.0], "width": 2400, "height": 1751},
    {"id": "bm-north", "group": "bm", "layer": BLUE_MARBLE, "date": None, "bounds": [60.0, 15.0, 98.0, 41.0], "width": 2400, "height": 1642},
    {"id": "plain", "group": "viirs", "layer": SAT_LAYER, "date": SAT_DATE, "bounds": [66.5, 22.5, 85.5, 37.5], "width": 2400, "height": 1895},
    {"id": "punjab", "group": "modis", "layer": MODIS_LAYER, "date": SAT_DATE, "bounds": [71.0, 27.6, 79.4, 34.2], "width": 2400, "height": 1886},
    {"id": "six", "group": "modis", "layer": MODIS_LAYER, "date": SAT_DATE, "bounds": [74.2, 29.3, 77.4, 31.7], "width": 2048, "height": 1536},
]
# 30 m true colour around the field view: Harmonized Landsat Sentinel-2 (HLS); the clearest recent date is chosen
FIELD_SCENE = {
    "id": "field", "group": "hls", "bounds": [75.35, 29.95, 76.35, 30.55], "width": 2048, "height": 1229,
    "layers": [("HLS_S30_Nadir_BRDF_Adjusted_Reflectance", "Sentinel-2"), ("HLS_L30_Nadir_BRDF_Adjusted_Reflectance", "Landsat")],
    "first": (10, 28), "last": (11, 24), "lag_days": 4, "preview": (512, 307), "min_preview_bytes": 12000, "min_bytes": 120000,
}

# Wikimedia Commons photo (CC BY-SA 2.0)
PHOTO = {
    "commons_file": "NP_India_burning1_(6314801805).jpg",
    "out": "assets/img/sangrur-2011-11-02.jpg",
    "credit": "Rice straw burning near Sangrur, 2 November 2011. Photo: Neil Palmer (CIAT), CC BY-SA 2.0, via Wikimedia Commons.",
    "page": "https://commons.wikimedia.org/wiki/File:NP_India_burning1_(6314801805).jpg",
    "licence": "https://creativecommons.org/licenses/by-sa/2.0/",
}

# NASA POWER, daily wind components at 50 m (MERRA-2), averaged over the burning season on the native grid
POWER_REGIONAL = "https://power.larc.nasa.gov/api/temporal/daily/regional"
WIND_PARAMS = ("U50M", "V50M")         # eastward and northward wind, m/s
WIND_TILES = [                         # lon_min, lat_min, lon_max, lat_max; each side at most 4.5 degrees
    (71.5, 26.5, 76.0, 30.5), (76.0, 26.5, 80.5, 30.5), (71.5, 30.5, 76.0, 34.5), (76.0, 30.5, 80.5, 34.5),
]
WIND_YEARS = list(range(2016, 2026))
WIND_START = (10, 15)
WIND_END = (11, 30)
WIND_MIN_VALID = 0.6                   # share of grid cells that must have data
