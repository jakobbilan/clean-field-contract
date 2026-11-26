"""NASA GIBS satellite images and the Wikimedia Commons photo."""
import os
import urllib.parse
import urllib.request

from . import config


def wms_url(scene, layer=config.SAT_LAYER, date=config.SAT_DATE):
    params = {
        "SERVICE": "WMS", "VERSION": "1.1.1", "REQUEST": "GetMap", "LAYERS": layer, "STYLES": "",
        "SRS": "EPSG:4326", "BBOX": ",".join(f"{v:g}" for v in scene["bounds"]),
        "WIDTH": scene["width"], "HEIGHT": scene["height"], "FORMAT": "image/jpeg", "TIME": date,
    }
    return config.GIBS_WMS + "?" + urllib.parse.urlencode(params)


def commons_url(file_name):
    return "https://commons.wikimedia.org/wiki/Special:FilePath/" + urllib.parse.quote(file_name)


def download_jpeg(url, path, min_bytes=20000, timeout=120):
    """Saves only a real JPEG of a plausible size; an error page or an empty tile is rejected."""
    req = urllib.request.Request(url, headers={"User-Agent": config.USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        body = r.read()
    if not body.startswith(b"\xff\xd8") or len(body) < min_bytes:
        raise ValueError(f"not a usable JPEG ({len(body)} bytes) from {url}")
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".part")
    tmp.write_bytes(body)
    os.replace(tmp, path)
    return len(body)
