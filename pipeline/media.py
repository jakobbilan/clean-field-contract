"""NASA GIBS satellite images and the Wikimedia Commons photo."""
import datetime as dt
import os
import urllib.parse
import urllib.request

from . import config


def wms_url(scene, layer=None, date=None, size=None):
    width, height = size or (scene["width"], scene["height"])
    params = {
        "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": layer or scene.get("layer", config.SAT_LAYER),
        "STYLES": "", "SRS": "EPSG:4326", "BBOX": ",".join(f"{v:g}" for v in scene["bounds"]),
        "WIDTH": width, "HEIGHT": height, "FORMAT": "image/jpeg", "TIME": date or scene.get("date", config.SAT_DATE),
    }
    return config.GIBS_WMS + "?" + urllib.parse.urlencode(params)


def commons_url(file_name):
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(file_name)


def fetch_jpeg(url, min_bytes=20000, timeout=120):
    """Returns the bytes of a real JPEG of a plausible size; an error page or an empty tile is rejected."""
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if not body.startswith(b"\xff\xd8") or len(body) < min_bytes:
        raise ValueError(f"not a usable JPEG ({len(body)} bytes)")
    return body


def save(body, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(body)
    os.replace(tmp, path)
    return len(body)


def download_jpeg(url, path, min_bytes=20000, timeout=120):
    return save(fetch_jpeg(url, min_bytes, timeout), path)


def field_candidates(season, today, scene=config.FIELD_SCENE):
    """Dates to try for the 30 m field image, newest first, within the season window and the HLS latency."""
    first, last = dt.date(season, *scene["first"]), dt.date(season, *scene["last"])
    last = min(last, today - dt.timedelta(days=scene["lag_days"]))
    out, d = [], last
    while d >= first:
        out.append(d)
        d -= dt.timedelta(days=1)
    return out


def best_field_image(season, today, log, scene=config.FIELD_SCENE):
    """Scores small previews by JPEG size (empty or cloud-covered views compress far smaller than fields), then
    downloads the best date at full size. Returns (bytes, date, layer, sensor) or None."""
    scored = []
    for d in field_candidates(season, today, scene):
        for layer, sensor in scene["layers"]:
            try:
                n = len(fetch_jpeg(wms_url(scene, layer, d.isoformat(), scene["preview"]), scene["min_preview_bytes"], 60))
                scored.append((n, d, layer, sensor))
            except Exception:
                continue
    if not scored:
        return None
    scored.sort(reverse=True)
    for n, d, layer, sensor in scored[:3]:
        try:
            body = fetch_jpeg(wms_url(scene, layer, d.isoformat()), scene["min_bytes"], 180)
            log(f"  field image: {sensor} {d} ({len(body) // 1024} KB, preview {n // 1024} KB)")
            return body, d, layer, sensor
        except Exception as e:
            log(f"  field image {d} {sensor} skipped: {e}")
    return None
