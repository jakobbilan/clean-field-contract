"""Checks that must pass before any file in data/ is replaced."""
from . import config, firms


class CheckError(ValueError):
    pass


def season(js, previous=None):
    w, s, e, n = config.PUNJAB_BBOX
    if js.get("cols") != firms.COLUMNS:
        raise CheckError("unexpected columns")
    rows = js["rows"]
    if js["count"] != len(rows):
        raise CheckError("count does not match rows")
    for r in rows:
        lon, lat, day, minute = r[0], r[1], r[2], r[3]
        if not (w <= lon <= e and s <= lat <= n):
            raise CheckError(f"point outside Punjab's box: {lon}, {lat}")
        if not (0 <= day < config.SEASON_DAYS and 0 <= minute < 1440):
            raise CheckError(f"day or time out of range: {r}")
    if previous and previous.get("season") == js["season"] and previous.get("source") == js["source"]:
        if previous["count"] and js["count"] < previous["count"] * (1 - config.SHRINK_TOLERANCE):
            raise CheckError(f"refresh would shrink {js['season']} from {previous['count']} to {js['count']} detections")


def live(js):
    if js.get("status") != "ok":
        return
    for part in ("current", "compare"):
        vals = js["cumulative"][part]["values"]
        if any(b < a for a, b in zip(vals, vals[1:])):
            raise CheckError(f"cumulative series {part} decreases")
        if vals and vals[-1] != js["cumulative"][part]["total_shown"]:
            raise CheckError(f"cumulative series {part} does not end at its total")
