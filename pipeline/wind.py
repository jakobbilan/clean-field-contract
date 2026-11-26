"""NASA POWER: daily wind components at 50 m (MERRA-2) over north-west India, averaged over the burning season.
The result is a mean vector field on the native grid; the page draws its streamlines."""
import json
import time
import urllib.parse

from . import config
from .firms import fetch_text


def regional_url(param, year, tile):
    lon0, lat0, lon1, lat1 = tile
    params = {
        "latitude-min": f"{lat0:g}", "latitude-max": f"{lat1:g}", "longitude-min": f"{lon0:g}", "longitude-max": f"{lon1:g}",
        "parameters": param, "community": "RE",
        "start": f"{year}{config.WIND_START[0]:02d}{config.WIND_START[1]:02d}",
        "end": f"{year}{config.WIND_END[0]:02d}{config.WIND_END[1]:02d}", "format": "JSON",
    }
    return config.POWER_REGIONAL + "?" + urllib.parse.urlencode(params)


def parse_regional(text, param):
    """{(lat, lon): (sum, n)} from a POWER regional GeoJSON response; fill values (-999) dropped."""
    js = json.loads(text)
    fill = js.get("header", {}).get("fill_value", -999)
    out = {}
    for f in js.get("features", []):
        lon, lat = f["geometry"]["coordinates"][:2]
        vals = f.get("properties", {}).get("parameter", {}).get(param, {})
        good = [float(v) for v in vals.values() if v is not None and float(v) != fill and float(v) > -900]
        if good:
            out[(round(float(lat), 4), round(float(lon), 4))] = (sum(good), len(good))
    return out


def assemble(acc):
    """acc[param][(lat, lon)] = [sum, n] -> grid of means with lats and lons ascending; None where missing."""
    keys = set(acc[config.WIND_PARAMS[0]]) | set(acc[config.WIND_PARAMS[1]])
    lats, lons = sorted({k[0] for k in keys}), sorted({k[1] for k in keys})
    grid = {}
    for p in config.WIND_PARAMS:
        grid[p] = [[(acc[p][(la, lo)][0] / acc[p][(la, lo)][1]) if (la, lo) in acc[p] and acc[p][(la, lo)][1] else None
                    for lo in lons] for la in lats]
    return lats, lons, grid


def build_field(log=print, pause=0.4):
    acc = {p: {} for p in config.WIND_PARAMS}
    for tile in config.WIND_TILES:
        for p in config.WIND_PARAMS:
            for year in config.WIND_YEARS:
                for k, (s, n) in parse_regional(fetch_text(regional_url(p, year, tile)), p).items():
                    cur = acc[p].setdefault(k, [0.0, 0])
                    cur[0] += s
                    cur[1] += n
                time.sleep(pause)
        log(f"  wind tile {tile}: done")
    lats, lons, grid = assemble(acc)
    u, v = grid["U50M"], grid["V50M"]
    cells = len(lats) * len(lons)
    valid = sum(1 for i in range(len(lats)) for j in range(len(lons)) if u[i][j] is not None and v[i][j] is not None)
    if cells == 0 or valid < config.WIND_MIN_VALID * cells:
        raise ValueError(f"wind field has {valid} of {cells} cells with data")
    if any(abs(x) > 40 for row in u + v for x in row if x is not None):
        raise ValueError("implausible wind speeds in the field")
    r = lambda x: None if x is None else round(x, 3)
    return {
        "status": "ok", "source": "NASA POWER, MERRA-2, daily U50M and V50M", "height_m": 50,
        "window": f"{config.WIND_START[1]} Oct to {config.WIND_END[1]} Nov", "years": [config.WIND_YEARS[0], config.WIND_YEARS[-1]],
        "lats": lats, "lons": lons, "u": [[r(x) for x in row] for row in u], "v": [[r(x) for x in row] for row in v],
    }
