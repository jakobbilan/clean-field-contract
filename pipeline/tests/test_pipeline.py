"""Offline tests on a synthetic file laid out like a FIRMS VIIRS CSV. Run: python -m pytest -q pipeline/tests"""
import datetime as dt
from pathlib import Path

import pytest

from pipeline import checks, config, firms, media
from pipeline.build import cumulative, season_record
from pipeline.geo import Locator

FIXTURE = Path(__file__).parent / "fixtures" / "viirs_sample.csv"


@pytest.fixture(scope="module")
def locator():
    return Locator(config.GEO_DISTRICTS)


def test_area_url_order_and_key():
    url = firms.area_url("KEY", "VIIRS_NOAA20_NRT", (73.8, 29.5, 77.0, 32.55), 5, dt.date(2026, 11, 1))
    assert url == "https://firms.modaps.eosdis.nasa.gov/api/area/csv/KEY/VIIRS_NOAA20_NRT/73.8,29.5,77,32.55/5/2026-11-01"


def test_parse_rejects_text_reply():
    with pytest.raises(firms.FirmsError):
        firms.parse("Invalid MAP_KEY.")


def test_ist_conversion():
    assert firms.to_ist("2026-11-05", "0811") == dt.datetime(2026, 11, 5, 13, 41)
    assert firms.to_ist("2026-11-06", "812") == dt.datetime(2026, 11, 6, 13, 42)
    assert firms.to_ist("2026-09-14", "2000").date() == dt.date(2026, 9, 15)


def test_locator(locator):
    assert locator.names[locator.locate(75.8431, 30.2412)] == "Sangrur"
    assert locator.names[locator.locate(75.8573, 30.901)] == "Ludhiana"
    assert locator.locate(74.3587, 31.5204) is None          # Lahore: inside the box, outside Punjab (India)


def test_compact_filters(locator):
    rows = firms.parse(FIXTURE.read_text())
    out = firms.compact(rows, 2026, locator)
    # kept: Sangrur (once, duplicate removed), Ludhiana, and the 14 Sep UTC night pass that is 15 Sep in India
    # dropped: low confidence (Patiala), outside Punjab (Lahore), after 30 November (Bathinda, 2 Dec)
    assert len(out) == 3
    days = sorted(r[2] for r in out)
    assert days == [0, 51, 52]
    sangrur = [r for r in out if r[5] == locator.names.index("Sangrur")][0]
    assert sangrur[:5] == [75.8431, 30.2412, 51, 13 * 60 + 41, 12.3]


def test_checks(locator):
    rows = firms.compact(firms.parse(FIXTURE.read_text()), 2026, locator)
    rec = season_record(2026, config.SOURCE_NRT, rows, dt.date(2026, 11, 26))
    checks.season(rec)
    bad = dict(rec, count=rec["count"] + 1)
    with pytest.raises(checks.CheckError):
        checks.season(bad)
    shrunk_prev = dict(rec, count=100)
    with pytest.raises(checks.CheckError):
        checks.season(rec, shrunk_prev)


def test_cumulative():
    rows = [[0, 0, 0, 0, 0, 0], [0, 0, 2, 0, 0, 0], [0, 0, 2, 0, 0, 0]]
    assert cumulative(rows, 3) == [1, 1, 3, 3]


def test_media_urls():
    url = media.wms_url(config.SAT_SCENES[2])
    assert "BBOX=73.3%2C29.2%2C77.3%2C32.8" in url and "SRS=EPSG%3A4326" in url and "TIME=2021-11-11" in url
    assert media.commons_url("NP_India_burning1_(6314801805).jpg").endswith("NP_India_burning1_%286314801805%29.jpg")


def test_wind_parse_and_rose():
    from pipeline import wind
    sample = {"header": {"fill_value": -999}, "properties": {"parameter": {
        "WD50M": {"2021101500": 315.0, "2021101501": 300.0, "2021101502": 5.0, "2021101503": 350.0, "2021101504": -999},
        "WS50M": {"2021101500": 3.0, "2021101501": 2.0, "2021101502": 0.2, "2021101503": 1.5, "2021101504": 4.0}}}}
    import json
    pairs = wind.parse(json.dumps(sample))
    assert len(pairs) == 4                         # the fill value is dropped
    r = wind.rose(pairs)
    shares = {s["from_deg"]: s["share"] for s in r["sectors"]}
    assert r["calm_share"] == 0.25                 # 0.2 m/s is calm
    assert shares[315.0] == 0.25 and shares[292.5] == 0.25 and shares[0.0] == 0.25   # 350 degrees falls in the north sector
    assert abs(sum(shares.values()) + r["calm_share"] - 1) < 1e-9
    assert "WD50M" in wind.power_url(2021) and "start=20211015" in wind.power_url(2021) and "end=20211130" in wind.power_url(2021)
