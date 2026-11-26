"""NASA POWER: hourly wind at 50 m above Ludhiana, summarised as a 16-sector wind rose for the burning season."""
import datetime as dt
import json
import urllib.parse

from . import config
from .firms import fetch_text


def power_url(year):
    start, end = dt.date(year, *config.WIND_START), dt.date(year, *config.WIND_END)
    params = {
        "parameters": "WS50M,WD50M", "community": "RE",
        "longitude": f"{config.WIND_POINT[1]:.4f}", "latitude": f"{config.WIND_POINT[0]:.4f}",
        "start": start.strftime("%Y%m%d"), "end": end.strftime("%Y%m%d"),
        "format": "JSON", "time-standard": "LST",
    }
    return config.POWER_HOURLY + "?" + urllib.parse.urlencode(params)


def parse(text):
    """(direction from, speed) pairs; fill values (-999) dropped."""
    js = json.loads(text)
    par = js["properties"]["parameter"]
    fill = js.get("header", {}).get("fill_value", -999)
    ws, wd = par["WS50M"], par["WD50M"]
    pairs = []
    for hour, d in wd.items():
        s = ws.get(hour)
        if d is None or s is None or d == fill or s == fill or d < 0 or s < 0:
            continue
        pairs.append((float(d) % 360.0, float(s)))
    return pairs


def rose(pairs, calm=config.WIND_CALM, sectors=16):
    """Share of all hours by the sector the wind came from (sector 0 is centred on north); calm hours apart."""
    width = 360.0 / sectors
    counts, speed, calms = [0] * sectors, [0.0] * sectors, 0
    for d, s in pairs:
        if s < calm:
            calms += 1
            continue
        i = int(((d + width / 2) % 360) // width)
        counts[i] += 1
        speed[i] += s
    n = len(pairs)
    return {
        "hours": n,
        "calm_share": round(calms / n, 4) if n else 0.0,
        "sectors": [{"from_deg": round(i * width, 2), "share": round(counts[i] / n, 4) if n else 0.0,
                     "mean_speed": round(speed[i] / counts[i], 2) if counts[i] else 0.0} for i in range(sectors)],
    }


def build(log=print):
    pairs = []
    for year in config.WIND_YEARS:
        got = parse(fetch_text(power_url(year)))
        log(f"  wind {year}: {len(got)} hours")
        pairs.extend(got)
    out = rose(pairs)
    days = (dt.date(2001, *config.WIND_END) - dt.date(2001, *config.WIND_START)).days + 1
    expected = days * 24 * len(config.WIND_YEARS)
    total = sum(s["share"] for s in out["sectors"]) + out["calm_share"]
    if out["hours"] < 0.8 * expected or abs(total - 1) > 0.01:
        raise ValueError(f"wind summary failed checks: {out['hours']} of {expected} hours, shares sum to {total:.3f}")
    out.update({"status": "ok", "source": "NASA POWER, MERRA-2, hourly", "height_m": 50, "place": config.WIND_PLACE,
                "lat": config.WIND_POINT[0], "lon": config.WIND_POINT[1],
                "window": f"{config.WIND_START[1]} Oct to {config.WIND_END[1]} Nov",
                "years": [config.WIND_YEARS[0], config.WIND_YEARS[-1]]})
    return out
