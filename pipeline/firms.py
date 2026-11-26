"""NASA FIRMS: request, parse and filter VIIRS fire detections for one season."""
import csv
import datetime as dt
import io
import time
import urllib.error
import urllib.request

from . import config

IST = dt.timedelta(hours=5, minutes=30)
COLUMNS = ["lon", "lat", "day", "min", "frp", "dist"]


class FirmsError(RuntimeError):
    pass


def area_url(key, source, bbox, days, date):
    area = ",".join(f"{v:g}" for v in bbox)
    return config.FIRMS_AREA.format(key=key, source=source, area=area, days=days, date=date.isoformat())


def fetch_text(url, tries=4, timeout=90):
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    for attempt in range(tries):
        try:
            with urllib.request.urlopen(req, timeout=timeout) as r:
                return r.read().decode("utf-8", "replace")
        except urllib.error.HTTPError as e:
            if e.code not in (429, 500, 502, 503, 504) or attempt == tries - 1:
                raise FirmsError(f"HTTP {e.code} for {url.replace(url.split('/')[6], 'KEY') if '/csv/' in url else url}")
        except (urllib.error.URLError, TimeoutError) as e:
            if attempt == tries - 1:
                raise FirmsError(f"network error: {e}")
        time.sleep(5 * (attempt + 1))
    raise FirmsError("unreachable")


def parse(text):
    """FIRMS returns CSV, or a short plain-text message (for example a bad MAP_KEY)."""
    head = text.lstrip()[:200]
    if not head.startswith("latitude"):
        raise FirmsError(f"unexpected FIRMS response: {head!r}")
    return list(csv.DictReader(io.StringIO(text)))


def season_bounds(season):
    start = dt.date(season, *config.SEASON_START)
    end = dt.date(season, *config.SEASON_END)
    return start, end


def to_ist(acq_date, acq_time):
    t = str(acq_time).strip().zfill(4)
    utc = dt.datetime.strptime(acq_date + t, "%Y-%m-%d%H%M")
    return utc + IST


def keep(row):
    return str(row.get("confidence", "")).strip().lower() not in ("l", "low")


def compact(rows, season, locator):
    """Rows inside Punjab and inside the season window, as [lon, lat, day, minute IST, frp, district]."""
    start, end = season_bounds(season)
    seen, out = set(), []
    for r in rows:
        if not keep(r):
            continue
        try:
            lat, lon = float(r["latitude"]), float(r["longitude"])
            ist = to_ist(r["acq_date"], r["acq_time"])
            frp = float(r.get("frp") or 0)
        except (KeyError, ValueError):
            continue
        if not (start <= ist.date() <= end):
            continue
        dist = locator.locate(lon, lat)
        if dist is None:
            continue
        key = (round(lat, 4), round(lon, 4), r["acq_date"], str(r["acq_time"]).zfill(4))
        if key in seen:
            continue
        seen.add(key)
        out.append([round(lon, 4), round(lat, 4), (ist.date() - start).days, ist.hour * 60 + ist.minute, round(frp, 1), dist])
    out.sort(key=lambda x: (x[2], x[3]))
    return out


def fetch_season(key, source, season, until, log=print):
    """All detections for a season up to `until` (inclusive), in requests of MAX_DAY_RANGE days.
    Starts a day early because the season is defined in India time and FIRMS dates are UTC."""
    start, end = season_bounds(season)
    day, last = start - dt.timedelta(days=1), min(end, until)
    rows = []
    while day <= last:
        n = min(config.MAX_DAY_RANGE, (last - day).days + 1)
        rows.extend(parse(fetch_text(area_url(key, source, config.PUNJAB_BBOX, n, day))))
        day += dt.timedelta(days=n)
        time.sleep(1)
    log(f"  {source} {season}: {len(rows)} raw rows")
    return rows
