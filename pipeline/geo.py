"""Point-in-polygon tests against Punjab's district boundaries (no third-party packages)."""
import json


def _polygons(geometry):
    if geometry["type"] == "Polygon":
        return [geometry["coordinates"]]
    if geometry["type"] == "MultiPolygon":
        return geometry["coordinates"]
    return []


def _in_ring(x, y, ring):
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i][0], ring[i][1]
        xj, yj = ring[j][0], ring[j][1]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _in_polygon(x, y, polygon):
    if not _in_ring(x, y, polygon[0]):
        return False
    return not any(_in_ring(x, y, hole) for hole in polygon[1:])


class Locator:
    """Finds the district that contains a point; None outside Punjab."""

    def __init__(self, path):
        features = json.loads(open(path, encoding="utf-8").read())["features"]
        self.names = []
        self.shapes = []
        for f in features:
            polys = _polygons(f["geometry"])
            xs = [p[0] for poly in polys for p in poly[0]]
            ys = [p[1] for poly in polys for p in poly[0]]
            self.names.append(f["properties"]["name"])
            self.shapes.append((min(xs), min(ys), max(xs), max(ys), polys))

    def locate(self, lon, lat):
        for i, (x0, y0, x1, y1, polys) in enumerate(self.shapes):
            if x0 <= lon <= x1 and y0 <= lat <= y1 and any(_in_polygon(lon, lat, p) for p in polys):
                return i
        return None
