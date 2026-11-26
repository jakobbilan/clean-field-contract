"""Rebuild data/: python -m pipeline.build [--refresh] [--offline] [--today YYYY-MM-DD]

Needs the environment variable FIRMS_MAP_KEY (free from NASA FIRMS) for fire detections.
Without it, imagery and the photo are still fetched and the page keeps its official figures."""
import argparse
import hashlib
import datetime as dt
import json
import os
import sys

from . import checks, config, firms, media, sentinel2, wind
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


def build_assets(refresh, offline, log, today=None):
    today = today or dt.datetime.utcnow().date()
    manifest = {"sat": [], "photo": None}
    for scene in config.SAT_SCENES:
        rel = f"assets/sat/{scene['group']}-{scene['date'] or 'static'}-{scene['id']}-{scene_key(scene)}.jpg"
        path = config.ROOT / rel
        if (refresh or not path.exists()) and not offline:
            try:
                n = media.download_jpeg(media.wms_url(scene), path)
                log(f"  satellite image {scene['id']}: {n // 1024} KB")
            except Exception as e:  # keep going: the map works without imagery
                log(f"  satellite image {scene['id']} skipped: {e}")
        if path.exists():
            manifest["sat"].append({"id": scene["id"], "group": scene["group"], "file": rel, "bounds": scene["bounds"],
                                    "date": scene["date"], "layer": scene["layer"]})
    manifest["sat"].extend(build_field_image(today, refresh, offline, log))
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
        for old in path.parent.glob("*.jpg"):          # an earlier photograph is removed
            if old.name != path.name:
                old.unlink()
    write_json(config.DATA / "assets.json", manifest)
    keep = {item["file"] for item in manifest["sat"]}
    folder = config.ROOT / "assets" / "sat"
    for old in (folder.glob("*.jpg") if folder.exists() else []):   # images from earlier layouts are removed
        if f"assets/sat/{old.name}" not in keep:
            old.unlink()


def scene_key(scene):
    """Short hash of what defines an image, so a change of area, size or layer never reuses an old file."""
    raw = json.dumps([scene["layer"], scene["bounds"], scene["width"], scene["height"]])
    return hashlib.sha1(raw.encode()).hexdigest()[:6]


def build_field_image(today, refresh, offline, log):
    """The 30 m image for the field view: refreshed each season once a clear date exists; the previous one is kept otherwise."""
    sc = config.FIELD_SCENE
    folder = config.ROOT / "assets" / "sat"
    existing = sorted(folder.glob("hls-*-field.jpg")) if folder.exists() else []
    meta_path = config.DATA / "field-image.json"
    meta = read_json(meta_path) or {}
    season = current_season(today)
    have_season = int(meta.get("date", "0000")[:4] or 0) if meta.get("date") else 0
    if not offline and (refresh or not existing or have_season < season or meta.get("bounds") != sc["bounds"]):
        for s in (season, season - 1):
            try:
                got = media.best_field_image(s, today, log, sc)
            except Exception as e:
                log(f"  field image search failed: {e}")
                got = None
            if got:
                body, d, layer, sensor = got
                rel = f"assets/sat/hls-{d.isoformat()}-field.jpg"
                for old in existing:
                    if old.name != f"hls-{d.isoformat()}-field.jpg":
                        old.unlink()
                media.save(body, config.ROOT / rel)
                meta = {"file": rel, "date": d.isoformat(), "layer": layer, "sensor": sensor, "bounds": sc["bounds"]}
                write_json(meta_path, meta)
                break
    if meta.get("file") and meta.get("bounds") == sc["bounds"] and (config.ROOT / meta["file"]).exists():
        return [{"id": "field", "group": "hls", "file": meta["file"], "bounds": sc["bounds"], "date": meta["date"],
                 "layer": meta["layer"], "sensor": meta["sensor"]}]
    return []


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
    build_assets(args.refresh, args.offline, print, today)
    field_path = config.DATA / "windfield.json"
    current = read_json(field_path) or {}
    if (args.refresh or current.get("status") != "ok") and not args.offline:
        try:
            write_json(field_path, wind.build_field(print))
        except Exception as e:  # the page falls back to a schematic flow and says so
            print(f"  wind field skipped: {e}")
    if not args.offline:
        try:
            sentinel2.build(today, args.refresh, print, read_json, write_json, current_season)
        except Exception as e:  # the page shows the Sentinel-2 chart only when its data exist
            print(f"  Sentinel-2 burnt land skipped: {e}")
    ok = True
    try:
        build_fires(today, args.refresh, args.offline, print)
    except (firms.FirmsError, checks.CheckError) as e:
        print(f"Fire data not updated: {e}", file=sys.stderr)
        ok = False
    # written on every run: records when data last ran and keeps the repository active between seasons
    write_json(config.DATA / "status.json", {"last_run": dt.datetime.utcnow().replace(microsecond=0).isoformat() + "Z",
                                               "season": current_season(today), "fires": "updated" if ok else "failed"})
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
