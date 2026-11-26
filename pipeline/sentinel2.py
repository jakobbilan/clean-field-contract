"""Copernicus Sentinel-2: share of each Punjab district's clear land with a burn scar at some point in the season.

An experimental estimate, not an official figure. Through the Copernicus Data Space Ecosystem (CDSE) Statistical
API, every clear Sentinel-2 L2A observation of the season is grouped into weeks; a weekly median of each band is
taken, and a pixel counts as burnt if any week has BAIS2 > 0.90 and NBR < 0.20 (Naeher and Ziulu 2025, using the
BAIS2 index of Filipponi 2018). Clouds, cloud shadow, water and snow are masked with the scene classification (SCL).
Needs CDSE_CLIENT_ID and CDSE_CLIENT_SECRET (an OAuth client from the CDSE Sentinel Hub dashboard).
"""
import datetime as dt
import json
import math
import os
import time
import urllib.parse
import urllib.request

from . import config

EVALSCRIPT = """//VERSION=3
function setup() {
  return {
    input: [{ bands: ["B04", "B06", "B07", "B08", "B8A", "B12", "SCL", "dataMask"] }],
    output: [{ id: "burnt", bands: 1, sampleType: "UINT8" }, { id: "dataMask", bands: 1 }],
    mosaicking: "ORBIT"
  };
}
var VALID = [2, 4, 5, 7];
var START = __START__;
var BANDS = ["B04", "B06", "B07", "B08", "B8A", "B12"];
function median(a) {
  a.sort(function (x, y) { return x - y; });
  var n = a.length;
  return n % 2 ? a[(n - 1) / 2] : (a[n / 2 - 1] + a[n / 2]) / 2;
}
function evaluatePixel(samples, scenes) {
  var weeks = {}, seen = 0;
  for (var i = 0; i < samples.length; i++) {
    var s = samples[i];
    if (!s.dataMask || VALID.indexOf(s.SCL) < 0 || s.B04 <= 0) continue;
    var t = Date.parse(scenes.orbits[i].dateFrom);
    var w = Math.floor((t - START) / 604800000);
    (weeks[w] = weeks[w] || []).push(s);
    seen = 1;
  }
  var burnt = 0;
  for (var k in weeks) {
    var list = weeks[k], b = {};
    for (var j = 0; j < BANDS.length; j++) {
      var name = BANDS[j];
      b[name] = median(list.map(function (x) { return x[name]; }));
    }
    var bais2 = (1 - Math.sqrt(b.B06 * b.B07 * b.B8A / b.B04)) * ((b.B12 - b.B8A) / Math.sqrt(b.B12 + b.B8A) + 1);
    var nbr = (b.B08 - b.B12) / (b.B08 + b.B12);
    if (bais2 > __BAIS2__ && nbr < __NBR__) { burnt = 1; break; }
  }
  return { burnt: [burnt], dataMask: [seen] };
}
"""


def evalscript(start):
    ms = int(dt.datetime(start.year, start.month, start.day, tzinfo=dt.timezone.utc).timestamp() * 1000)
    return (EVALSCRIPT.replace("__START__", str(ms)).replace("__BAIS2__", f"{config.S2_BAIS2_MIN:.2f}")
            .replace("__NBR__", f"{config.S2_NBR_MAX:.2f}"))


def stats_request(geometry, start, end):
    days = (end - start).days + 1
    return {
        "input": {
            "bounds": {"geometry": geometry, "properties": {"crs": "http://www.opengis.net/def/crs/OGC/1.3/CRS84"}},
            "data": [{"type": "sentinel-2-l2a", "dataFilter": {"maxCloudCoverage": config.S2_MAX_CLOUD}}],
        },
        "aggregation": {
            "timeRange": {"from": f"{start.isoformat()}T00:00:00Z", "to": f"{end.isoformat()}T23:59:59Z"},
            "aggregationInterval": {"of": f"P{days}D", "lastIntervalBehavior": "SHORTEN"},
            "evalscript": evalscript(start),
            "resx": config.S2_RES_DEG, "resy": config.S2_RES_DEG,
        },
        "calculations": {"default": {}},
    }


def parse_stats(js):
    """(share burnt, valid samples) from a Statistical API response with one interval."""
    rows = js.get("data") or []
    if not rows:
        raise ValueError("no intervals in the response")
    row = rows[0]
    if row.get("error"):
        raise ValueError(f"interval error: {row['error']}")
    st = row["outputs"]["burnt"]["bands"]["B0"]["stats"]
    valid = int(st.get("sampleCount", 0)) - int(st.get("noDataCount", 0))
    if valid <= 0:
        return None, 0
    return float(st["mean"]), valid


def area_km2(geometry):
    """Area of a lon/lat polygon or multipolygon, from a local equal-area projection (good to well under 1%)."""
    polys = geometry["coordinates"] if geometry["type"] == "MultiPolygon" else [geometry["coordinates"]]
    lat0 = math.radians(sum(p[1] for poly in polys for p in poly[0]) / max(1, sum(len(poly[0]) for poly in polys)))
    kx, ky = 111.320 * math.cos(lat0), 110.574

    def ring(r):
        return abs(sum((r[i][0] * kx) * (r[i + 1][1] * ky) - (r[i + 1][0] * kx) * (r[i][1] * ky) for i in range(len(r) - 1))) / 2

    return sum(ring(poly[0]) - sum(ring(h) for h in poly[1:]) for poly in polys)


def due(record, today, refresh=False):
    """The running season is recomputed weekly while it lasts; a finished season is computed once."""
    if refresh or not record:
        return True
    end_season = dt.date(today.year if today.month >= 9 else today.year - 1, *config.S2_SEASON[1])
    last = dt.date.fromisoformat(record["computed"])
    to = dt.date.fromisoformat(record["to"])
    return to < end_season and (today - last).days >= config.S2_EVERY_DAYS


def token(cid, secret):
    data = urllib.parse.urlencode({"grant_type": "client_credentials", "client_id": cid, "client_secret": secret}).encode()
    req = urllib.request.Request(config.CDSE_TOKEN, data=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
    with urllib.request.urlopen(req, timeout=60) as r:
        return json.loads(r.read())["access_token"]


def post(body, tok):
    req = urllib.request.Request(config.CDSE_STATS, data=json.dumps(body).encode(),
                                 headers={"Authorization": f"Bearer {tok}", "Content-Type": "application/json",
                                          "Accept": "application/json", "User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=600) as r:
        return json.loads(r.read())


def season_record(features, start, end, cid, secret, log):
    districts, burnt_samples, all_samples = [], 0.0, 0
    for f in features:
        name = f["properties"].get("name")
        try:
            share, valid = parse_stats(post(stats_request(f["geometry"], start, end), token(cid, secret)))
        except Exception as e:
            log(f"  Sentinel-2 {name}: skipped ({e})")
            continue
        if share is None:
            continue
        districts.append({"name": name, "share": round(share, 4), "area_km2": round(area_km2(f["geometry"]), 1)})
        burnt_samples += share * valid
        all_samples += valid
        time.sleep(0.3)
    if len(districts) < 0.8 * len(features) or not all_samples:
        raise ValueError(f"only {len(districts)} of {len(features)} districts returned data")
    return {"from": start.isoformat(), "to": end.isoformat(), "computed": dt.date.today().isoformat(),
            "state_share": round(burnt_samples / all_samples, 4), "districts": districts}


def build(today, refresh, log, read_json, write_json, current_season):
    cid, secret = os.environ.get("CDSE_CLIENT_ID"), os.environ.get("CDSE_CLIENT_SECRET")
    path = config.DATA / "burnt.json"
    out = read_json(path) or {}
    out.setdefault("seasons", {})
    if not cid or not secret:
        log("  Sentinel-2 burnt land: no CDSE credentials set, skipped")
        if not path.exists():
            write_json(path, {"status": "none", "seasons": {}})
        return
    features = json.loads((config.ROOT / "geo" / "punjab-districts.geojson").read_text(encoding="utf-8"))["features"]
    season = current_season(today)
    for s in (season, season - 1):
        start = dt.date(s, *config.S2_SEASON[0])
        end = min(dt.date(s, *config.S2_SEASON[1]), today - dt.timedelta(days=1))
        if end <= start + dt.timedelta(days=6):
            continue
        rec = out["seasons"].get(str(s))
        if not due(rec, today, refresh):
            continue
        log(f"  Sentinel-2 burnt land {s}: {start} to {end}")
        try:
            out["seasons"][str(s)] = season_record(features, start, end, cid, secret, log)
        except Exception as e:
            log(f"  Sentinel-2 burnt land {s} not updated: {e}")
    out.update({"status": "ok" if out["seasons"] else "none", "source": "Copernicus Sentinel-2 L2A, Copernicus Data Space Ecosystem",
                "method": f"weekly medians; burnt where BAIS2 > {config.S2_BAIS2_MIN:.2f} and NBR < {config.S2_NBR_MAX:.2f}; SCL mask",
                "resolution_deg": config.S2_RES_DEG})
    write_json(path, out)
