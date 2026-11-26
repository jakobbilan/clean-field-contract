"""Rebuild data/: python -m pipeline.build [--refresh] [--offline] [--today YYYY-MM-DD]

Needs the environment variable FIRMS_MAP_KEY (free from NASA FIRMS) for fire detections.
Without it, imagery and the photo are still fetched and the page keeps its official figures."""
import argparse
import datetime as dt
import json
import os
import sys

from . import checks, config, firms, media, wind
from .geo import Locator


def write_json(path, obj):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".json.part")
    tmp.write_text(json.dumps(obj, separators=(",", ":"), ensure_ascii=False), encoding="utf-8")
    os.replace(tmp, path)


def read_json(path):
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except (FileNotFoundError, ValueError):
        return None


def current_season(today):
    return today.year if (today.month, today.day) >= config.SEASON_START else today.year - 1


def build_assets(refresh, offline, log):
    manifest = {"sat": [], "photo": None}
    for scene in config.SAT_SCENES:
        rel = f"assets/sat/viirs-{config.SAT_DATE}-{scene['id']}.jpg"
        path = config.ROOT / rel
        if (refresh or not path.exists()) and not offline:
            try:
                n = media.download_jpeg(media.wms_url(scene), path)
                log(f"  satellite image {scene['id']}: {n // 1024} KB")
            except Exception as e:  # keep going: the map works without imagery
                log(f"  satellite image {scene['id']} skipped: {e}")
        if path.exists():
            manifest["sat"].append({"id": scene["id"], "file": rel, "bounds": scene["bounds"],
                                    "date": config.SAT_DATE, "layer": config.SAT_LAYER})
    p = config.PHOTO
    path = config.ROOT / p["out"]
    if (refresh or not path.exists()) and not offline:
        try:
            n = media.download_jpeg(media.commons_url(p["commons_file"]), path)
            log(f"  photo: {n // 1024} KB")
        except Exception as e:
            log(f"  photo skipped: {e}")
    if path.exists():
        manifest["photo"] = {"file": p["out"], "credit": p["credit"], "page": p["page"], "licence": p["licence"]}
    write_json(config.DATA / "assets.json", manifest)


def season_record(season, source, rows, until):
    start, end = firms.season_bounds(season)
    last_day = max((r[2] for r in rows), default=0)
    through = min(end, until)
    return {"season": season, "satellite": config.SATELLITE, "source": source, "count": len(rows),
            "last_day": last_day, "through": through.isoformat(), "cols": firms.COLUMNS, "rows": rows}


def cumulative(rows, upto_day):
    counts = [0] * config.SEASON_DAYS
    for r in rows:
        counts[r[2]] += 1
    out, run = [], 0
    for d in range(upto_day + 1):
        run += counts[d]
        out.append(run)
    return out


def build_fires(today, refresh, offline, log):
    key = os.environ.get("FIRMS_MAP_KEY", "").strip()
    locator = Locator(config.GEO_DISTRICTS)
    cur = current_season(today)
    running = (today.month, today.day) <= config.UPDATE_UNTIL and cur == today.year
    for season in sorted({config.SEASON_A, cur - 1, cur}):
        path = config.DATA / f"fires-{season}.json"
        previous = read_json(path)
        start, end = firms.season_bounds(season)
        use_sp = (today - end).days >= config.SP_LAG_DAYS
        source = config.SOURCE_SP if use_sp else config.SOURCE_NRT
        stale = previous is None or refresh or (season == cur and running) or (previous.get("source") != source)
        if not stale or offline:
            continue
        if not key:
            log(f"  {season}: no FIRMS_MAP_KEY set, fire data not fetched")
            continue
        until = min(end, today)
        rows = firms.compact(firms.fetch_season(key, source, season, until, log), season, locator)
        record = season_record(season, source, rows, until)
        checks.season(record, previous)
        write_json(path, record)
        log(f"  {season}: {len(rows)} detections in Punjab ({source})")

    a, b, c = (read_json(config.DATA / f"fires-{s}.json") for s in (config.SEASON_A, cur, cur - 1))
    if not (a and b and c):
        write_json(config.DATA / "live.json", {"status": "no-data", "updated": dt.datetime.utcnow().isoformat() + "Z"})
        return
    upto = b["last_day"] if b["count"] else 0
    cur_vals, cmp_vals = cumulative(b["rows"], upto), cumulative(c["rows"], config.SEASON_DAYS - 1)
    live = {
        "status": "ok", "updated": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
        "satellite": config.SATELLITE, "districts": locator.names,
        "map": {"A": f"data/fires-{config.SEASON_A}.json", "B": f"data/fires-{cur}.json"},
        "cumulative": {
            "current": {"season": cur, "values": cur_vals, "total": b["count"], "total_shown": cur_vals[-1] if cur_vals else 0},
            "compare": {"season": cur - 1, "values": cmp_vals, "total": c["count"], "total_shown": cmp_vals[-1],
                        "toDate": cmp_vals[min(upto, len(cmp_vals) - 1)]},
        },
    }
    checks.live(live)
    write_json(config.DATA / "live.json", live)


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--refresh", action="store_true", help="download everything again")
    ap.add_argument("--offline", action="store_true", help="no network; rebuild from files already in data/")
    ap.add_argument("--today", help="pretend today is this date (YYYY-MM-DD)")
    args = ap.parse_args(argv)
    today = dt.date.fromisoformat(args.today) if args.today else dt.datetime.utcnow().date()
    print(f"Building for {today}")
    build_assets(args.refresh, args.offline, print)
    wind_path = config.DATA / "wind.json"
    current = read_json(wind_path) or {}
    if (args.refresh or current.get("status") != "ok") and not args.offline:
        try:
            write_json(wind_path, wind.build(print))
        except Exception as e:  # the page falls back to the north-west sector
            print(f"  wind summary skipped: {e}")
    try:
        build_fires(today, args.refresh, args.offline, print)
    except (firms.FirmsError, checks.CheckError) as e:
        print(f"Fire data not updated: {e}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
