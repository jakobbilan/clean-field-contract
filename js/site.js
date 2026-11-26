/* The Clean Field Contract: map story, charts and controls. Needs d3 7.9, topojson-client 3.1, geo.js and data.js. */
(function () {
  'use strict';
  var D = window.CFC_DATA, G = window.CFC_GEO, d3 = window.d3, topojson = window.topojson;
  if (!D || !G || !d3 || !topojson) return;

  var root = document.documentElement;
  root.classList.add('js');
  var reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  var narrowMQ = window.matchMedia('(max-width: 899px)');
  var C = Math.cos(30 * Math.PI / 180);           // projection: x = lon * cos(30 deg), y = -lat
  var KM_PER_DEG = 111.2;
  var SEASON_DAYS = 77;                            // 15 September to 30 November
  var fmt = d3.format(',');
  var inr = function (v) { return '\u20b9' + Math.round(v).toLocaleString('en-IN'); };
  var clamp = function (v, a, b) { return Math.max(a, Math.min(b, v)); };
  var tok = function (n) { return getComputedStyle(root).getPropertyValue(n).trim(); };
  var MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  function seasonDate(season, day) { return new Date(Date.UTC(season, 8, 15 + day)); }
  function longDate(dt) { return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()] + ' ' + dt.getUTCFullYear(); }
  function shortDate(dt) { return dt.getUTCDate() + ' ' + MONTHS[dt.getUTCMonth()].slice(0, 3); }
  function roundAbout(v) { return v >= 1000 ? Math.round(v / 100) * 100 : Math.round(v / 10) * 10; }

  /* ------------------------------------------------------------ geometry */
  var IN = window.CFC_INDIA || null;
  var districtsObj = G.objects.districts, statesObj = G.objects.states;
  var F = {
    districts: topojson.feature(G, districtsObj).features,
    states: topojson.feature(G, statesObj).features,
    land: topojson.feature(G, G.objects.land),
    rivers: topojson.feature(G, G.objects.rivers).features.filter(function (f) {
      return ['Sutlej', 'Beas', 'Ravi', 'Yamuna', 'Ganges', 'Chenab', 'Jhelum', 'Indus'].indexOf(f.properties.name) >= 0;
    })
  };
  var stateNamed = function (n) { return F.states.filter(function (f) { return f.properties.name === n; })[0]; };
  var punjab = stateNamed('PUNJAB');
  var stateMesh = topojson.mesh(G, statesObj, function (a, b) { return a !== b; });
  var districtMesh = topojson.mesh(G, districtsObj, function (a, b) { return a !== b; });
  var sixFeatures = { type: 'FeatureCollection', features: F.districts.filter(function (f) { return f.properties.six; }) };
  var sixOutline = topojson.mesh(G, districtsObj, function (a, b) {
    return (a === b && a.properties.six) || (a !== b && a.properties.six !== b.properties.six);
  });
  var india = IN ? IN.outline : null, indiaStates = IN ? IN.states : null;
  var riversFC = { type: 'FeatureCollection', features: F.rivers };
  var FIELD = (D.field && D.field.bounds) || [75.35, 29.95, 76.35, 30.55];
  var put = function (k, v) { document.querySelectorAll('[data-live="' + k + '"]').forEach(function (el) { el.textContent = v; }); };

  /* ------------------------------------------------------------ stage: everything is drawn in screen pixels, every frame */
  var stageEl = document.getElementById('stage');
  var mapOK = !!stageEl;
  var W = 0, H = 0, dpr = 1, cam = null, flight = null, active = -1, focus = null;
  var svgBase, gBase, gSatImgs, dimRect, gOver, gLines, gWind, canvas, ctx, svgTop, gGrat, gLabels, gFocus, gScale, gInset, hud, credit, photo;
  var layers = {};
  var assets = { sat: [], photo: null, field: null };
  var fires = { A: null, B: null, meta: null };
  var wind = { lines: [], measured: false, paths: null, heads: null };
  var fireState = { key: null, dayMax: SEASON_DAYS - 1 };
  var stepEls = Array.prototype.slice.call(document.querySelectorAll('.step'));

  var screenT = d3.geoTransform({ point: function (lon, lat) { this.stream.point(cam.tx + cam.k * lon * C, cam.ty - cam.k * lat); } });
  var spath = d3.geoPath(screenT);
  if (spath.digits) spath.digits(1);
  var P = function (lon, lat) { return [cam.tx + cam.k * lon * C, cam.ty - cam.k * lat]; };

  var BOUNDS = {
    wide: [[66.0, 6.5], [99.0, 37.6]],
    north: [[68.5, 22.5], [89.5, 35.6]],
    plain: [[72.3, 27.4], [79.7, 33.1]],
    punjab: [[73.8, 29.5], [77.0, 32.55]],
    six: [[74.75, 29.8], [76.85, 31.2]]
  };
  var WIDE_LINES = ['indiaStates', 'indiaLine'];
  var STEPS = [
    { view: 'wide', sat: ['bm', 'viirs'], layers: ['land', 'indiaFill', 'punjabFill'].concat(WIDE_LINES), labels: 'wide' },
    { view: 'north', sat: ['bm', 'viirs'], layers: ['land', 'indiaFill', 'punjabFill', 'rivers'].concat(WIDE_LINES), labels: 'north' },
    { view: 'plain', sat: ['viirs'], layers: ['land', 'indiaFill', 'rivers', 'punjabLine'].concat(WIDE_LINES), labels: 'plain', wind: true },
    { view: 'plain', sat: ['viirs'], layers: ['land', 'indiaFill', 'rivers', 'punjabFill', 'punjabLine'].concat(WIDE_LINES), labels: 'plain' },
    { view: 'punjab', sat: ['modis'], dim: true, layers: ['land', 'indiaFill', 'pbBase', 'rivers', 'states', 'districts', 'punjabLine', 'indiaLine'], labels: 'punjab', fires: 'A', scrub: true, grat: 1 },
    { view: 'punjab', sat: ['modis'], dim: true, layers: ['land', 'indiaFill', 'pbBase', 'rivers', 'states', 'districts', 'punjabLine', 'indiaLine'], labels: 'punjab', fires: 'B', scrub: true, grat: 1 },
    { view: 'six', sat: ['modis'], dim: true, layers: ['land', 'indiaFill', 'pbBase', 'six', 'states', 'districts', 'sixLine', 'punjabLine', 'indiaLine'], labels: 'six', fires: 'B', grat: 0.5, inset: true },
    { view: 'field', sat: ['hls'], layers: ['land', 'pbBase', 'districts'], labels: 'none', fires: 'B', grat: 0.1, focus: true, inset: true },
    { view: 'field', sat: ['hls'], layers: ['land', 'pbBase', 'districts'], labels: 'none', fires: 'B', grat: 0.1, focus: true, inset: true, photo: true }
  ];
  var LAYER_DEFS = [
    ['land', F.land, 'base', 'm-land'],
    ['indiaFill', india, 'base', 'm-india'],
    ['pbBase', punjab, 'base', 'm-pbbase'],
    ['punjabFill', punjab, 'over', 'm-pbfill'],
    ['six', sixFeatures, 'over', 'm-six'],
    ['rivers', riversFC, 'lines', 'm-rivers'],
    ['indiaStates', indiaStates, 'lines', 'm-instates'],
    ['states', stateMesh, 'lines', 'm-states'],
    ['districts', districtMesh, 'lines', 'm-districts'],
    ['sixLine', sixOutline, 'lines', 'm-sixline'],
    ['punjabLine', punjab, 'lines', 'm-pbline'],
    ['indiaLine', india, 'lines', 'm-inline']
  ];
  var COVERED_BY_SAT = { land: 1, indiaFill: 1, pbBase: 1 };

  function buildStage() {
    svgBase = d3.select(stageEl).append('svg').attr('class', 'map');
    gBase = svgBase.append('g');
    var gSat = svgBase.append('g');
    gSatImgs = gSat.append('g');
    dimRect = gSat.append('rect').attr('class', 'm-dim').attr('x', 0).attr('y', 0).style('opacity', 0);
    gOver = svgBase.append('g');
    gLines = svgBase.append('g');
    gWind = svgBase.append('g').attr('class', 'm-wind').style('opacity', 0);
    var groups = { base: gBase, over: gOver, lines: gLines };
    LAYER_DEFS.forEach(function (d) {
      if (!d[1]) return;
      layers[d[0]] = { el: groups[d[2]].append('path').attr('class', d[3]).style('opacity', 0), datum: d[1], target: 0, vis: false };
    });

    canvas = document.createElement('canvas');
    canvas.className = 'fires';
    stageEl.appendChild(canvas);
    ctx = canvas.getContext('2d');

    svgTop = d3.select(stageEl).append('svg').attr('class', 'top');
    gGrat = svgTop.append('g');
    gLabels = svgTop.append('g');
    gFocus = svgTop.append('g');
    gScale = svgTop.append('g');
    gInset = svgTop.append('g').attr('class', 'inset');

    photo = document.createElement('img');
    photo.className = 'photo';
    photo.alt = 'Rice straw burning in a harvested paddy field near Sangrur, Punjab, November 2011.';
    stageEl.appendChild(photo);
    hud = document.createElement('div'); hud.className = 'hud'; stageEl.appendChild(hud);
    credit = document.createElement('p'); credit.className = 'credit'; stageEl.appendChild(credit);
    resizeStage();
  }

  function setLayer(name, on) {
    var L = layers[name];
    if (!L || L.target === (on ? 1 : 0)) return;
    L.target = on ? 1 : 0;
    if (on) { L.vis = true; if (cam) L.el.attr('d', spath(L.datum)); }
    L.el.interrupt().transition().duration(reduceMotion ? 0 : 420).style('opacity', on ? 1 : 0)
      .on('end', function () { if (!L.target) L.vis = false; });
  }
  function fade(sel, on, ms) { sel.interrupt().transition().duration(reduceMotion ? 0 : (ms || 500)).style('opacity', on ? 1 : 0); }

  function resizeStage() {
    W = stageEl.clientWidth; H = stageEl.clientHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    [svgBase, svgTop].forEach(function (s) { s.attr('width', W).attr('height', H).attr('viewBox', '0 0 ' + W + ' ' + H); });
    dimRect.attr('width', W).attr('height', H);
    applyView(active >= 0 ? viewFor(active) : viewForBounds(BOUNDS.wide));
  }
  function panelSpace(i) {
    if (!narrowMQ.matches || i == null || i < 0 || !stepEls[i]) return 0;
    var pnl = stepEls[i].querySelector('.panel');
    return pnl ? clamp(pnl.offsetHeight + 12, H * 0.3, H * 0.62) : H * 0.44;
  }
  function viewForBounds(b, i) {
    var mob = narrowMQ.matches;
    var pl = W * 0.06, pr = W * 0.06, pt = H * (mob ? 0.1 : 0.08), pb = mob ? panelSpace(i === undefined ? active : i) : H * 0.08;
    var x0 = b[0][0] * C, x1 = b[1][0] * C, y0 = -b[1][1], y1 = -b[0][1];
    var k = Math.min((W - pl - pr) / (x1 - x0), (H - pt - pb) / (y1 - y0));
    var sx = pl + (W - pl - pr) / 2, sy = pt + (H - pt - pb) / 2;
    var tx = sx - k * (x0 + x1) / 2, ty = sy - k * (y0 + y1) / 2;
    return [(W / 2 - tx) / k, (H / 2 - ty) / k, W / k];
  }
  function viewFor(i) {
    var s = STEPS[i];
    if (s.view === 'field') {
      var f = focusPoint(), v = viewForBounds([[f.lon - 0.17, f.lat - 0.105], [f.lon + 0.17, f.lat + 0.105]], i);
      if (assets.field) {                       // keep the visible part of the map inside the 30 m image where it fits
        var b = assets.field.bounds, k = W / v[2], Hv = H - panelSpace(i), shift = (H - Hv) / 2 / k;
        var hw = v[2] / 2, hh = Hv / k / 2, cyv = v[1] - shift;
        var xs = [b[0] * C + hw, b[2] * C - hw], ys = [-b[3] + hh, -b[1] - hh];
        v[0] = xs[0] <= xs[1] ? clamp(v[0], xs[0], xs[1]) : (b[0] + b[2]) / 2 * C;
        cyv = ys[0] <= ys[1] ? clamp(cyv, ys[0], ys[1]) : -(b[1] + b[3]) / 2;
        v[1] = cyv + shift;
      }
      return v;
    }
    return viewForBounds(BOUNDS[s.view], i);
  }
  function applyView(v) {
    var k = W / v[2];
    cam = { k: k, tx: W / 2 - k * v[0], ty: H / 2 - k * v[1], v: v };
    renderMap();
  }
  function flyTo(v) {
    if (flight) flight.stop();
    if (reduceMotion || !cam) { applyView(v); return; }
    var i = d3.interpolateZoom(cam.v, v), ms = clamp(i.duration * 0.85, 700, 1900);
    flight = d3.timer(function (el) {
      var t = Math.min(1, el / ms);
      applyView(i(d3.easeCubicInOut(t)));
      if (t >= 1) { flight.stop(); flight = null; }
    });
  }
  function renderMap() {
    if (!cam) return;
    Object.keys(layers).forEach(function (n) { var L = layers[n]; if (L.vis) L.el.attr('d', spath(L.datum)); });
    renderSat(); renderWind(); drawOverlay(); drawFires(); drawInset();
  }

  /* ------------------------------------------------------------ satellite images (NASA GIBS), placed in screen pixels */
  function addSatImage(meta) {
    meta.group = meta.group || 'viirs';
    var el = gSatImgs.append('image').attr('href', meta.file).attr('preserveAspectRatio', 'none').style('opacity', 0);
    assets.sat.push({ meta: meta, el: el, on: false });
    if (meta.group === 'hls') assets.field = meta;
  }
  function satAvailable(group) { return assets.sat.some(function (s) { return s.meta.group === group; }); }
  function pickSat(prefs) { return (prefs || []).filter(satAvailable)[0] || null; }
  function renderSat() {
    assets.sat.forEach(function (s) {
      if (!s.on && +s.el.style('opacity') === 0) return;
      var b = s.meta.bounds, p0 = P(b[0], b[3]), p1 = P(b[2], b[1]);
      s.el.attr('x', p0[0]).attr('y', p0[1]).attr('width', Math.max(0, p1[0] - p0[0])).attr('height', Math.max(0, p1[1] - p0[1]));
    });
  }

  /* ------------------------------------------------------------ wind: evenly spaced streamlines of the mean flow */
  function gridField(w) {
    var lons = w.lons, lats = w.lats, U = w.u, V = w.v;
    function idx(arr, x) {
      if (x <= arr[0]) return [0, 0, 0];
      if (x >= arr[arr.length - 1]) return [arr.length - 1, arr.length - 1, 0];
      var j = d3.bisectRight(arr, x) - 1;
      return [j, j + 1, (x - arr[j]) / (arr[j + 1] - arr[j])];
    }
    return function (lon, lat) {
      var a = idx(lats, lat), b = idx(lons, lon), out = [0, 0], wsum = 0;
      [[a[0], b[0], (1 - a[2]) * (1 - b[2])], [a[0], b[1], (1 - a[2]) * b[2]], [a[1], b[0], a[2] * (1 - b[2])], [a[1], b[1], a[2] * b[2]]].forEach(function (c) {
        var u = U[c[0]] && U[c[0]][c[1]], v = V[c[0]] && V[c[0]][c[1]];
        if (u == null || v == null || !isFinite(u) || !isFinite(v)) return;
        out[0] += u * c[2]; out[1] += v * c[2]; wsum += c[2];
      });
      return wsum > 0.3 ? [out[0] / wsum, out[1] / wsum] : null;
    };
  }
  function schematicField() {
    var dir = 135 * Math.PI / 180;            // a north-westerly wind blows towards 135 degrees
    return function () { return [2 * Math.sin(dir), 2 * Math.cos(dir)]; };
  }
  function computeStreamlines(field) {
    var x0 = 70.6 * C, x1 = 81.0 * C, y0 = 26.0, y1 = 34.4;   // projected x, latitude
    var dsep = 0.46, dtest = 0.23, h = 0.045, maxSteps = 320, cell = dtest;
    var hash = {}, lines = [];
    var key = function (x, y) { return Math.floor(x / cell) + ':' + Math.floor(y / cell); };
    function near(x, y, d, own) {
      var cx = Math.floor(x / cell), cy = Math.floor(y / cell), r = Math.ceil(d / cell);
      for (var i = -r; i <= r; i++) for (var j = -r; j <= r; j++) {
        var b = hash[(cx + i) + ':' + (cy + j)];
        if (!b) continue;
        for (var k = 0; k < b.length; k++) {
          if (own && b[k][2] === own) continue;
          var dx = b[k][0] - x, dy = b[k][1] - y;
          if (dx * dx + dy * dy < d * d) return true;
        }
      }
      return false;
    }
    function dirAt(x, y) {
      var w = field(x / C, y);
      if (!w) return null;
      var s = Math.sqrt(w[0] * w[0] + w[1] * w[1]);
      return s < 0.15 ? null : [w[0] / s, w[1] / s, s];
    }
    function trace(sx, sy, sign, id) {
      var pts = [], x = sx, y = sy;
      for (var n = 0; n < maxSteps; n++) {
        var a = dirAt(x, y); if (!a) break;
        var mx = x + sign * a[0] * h / 2, my = y + sign * a[1] * h / 2, b = dirAt(mx, my); if (!b) break;
        x += sign * b[0] * h; y += sign * b[1] * h;
        if (x < x0 || x > x1 || y < y0 || y > y1) break;
        if (near(x, y, dtest, id)) break;
        pts.push([x, y, b[2]]);
      }
      return pts;
    }
    var id = 0;
    for (var gy = y0 + dsep / 2; gy < y1; gy += dsep) {
      for (var gx = x0 + dsep / 2; gx < x1; gx += dsep) {
        var jx = gx + (Math.sin(gx * 12.9898 + gy * 78.233) * 0.5) * dsep * 0.6, jy = gy + (Math.cos(gx * 39.346 + gy * 11.135) * 0.5) * dsep * 0.6;
        if (near(jx, jy, dsep, null) || !dirAt(jx, jy)) continue;
        id += 1;
        var back = trace(jx, jy, -1, id).reverse(), fwd = trace(jx, jy, 1, id);
        var pts = back.concat([[jx, jy, (dirAt(jx, jy) || [0, 0, 0])[2]]], fwd);
        if (pts.length < 14) continue;
        pts.forEach(function (p) { var kk = key(p[0], p[1]); (hash[kk] = hash[kk] || []).push([p[0], p[1], id]); });
        lines.push(pts.map(function (p) { return [p[0] / C, p[1], p[2]]; }));
      }
    }
    return lines;
  }
  function setWind(field, measured) {
    wind.lines = computeStreamlines(field);
    wind.measured = measured;
    root.classList.toggle('wind-ready', measured);
    gWind.selectAll('*').remove();
    wind.under = gWind.selectAll('path.flow-bg').data(wind.lines).enter().append('path').attr('class', 'flow-bg');
    wind.paths = gWind.selectAll('path.flow').data(wind.lines).enter().append('path').attr('class', 'flow')
      .style('stroke-width', function (l) { return measured ? (0.9 + 0.35 * clamp(d3.mean(l, function (p) { return p[2]; }), 0, 4)).toFixed(2) + 'px' : null; });
    wind.heads = gWind.selectAll('path.head').data(wind.lines).enter().append('path').attr('class', 'head');
    renderWind();
  }
  function renderWind() {
    if (!wind.paths || !cam || +gWind.style('opacity') === 0 && !(active >= 0 && STEPS[active].wind)) return;
    var line = function (l) {
      var s = '';
      for (var i = 0; i < l.length; i += 2) { var p = P(l[i][0], l[i][1]); s += (i ? 'L' : 'M') + p[0].toFixed(1) + ',' + p[1].toFixed(1); }
      return s;
    };
    wind.under.attr('d', line);
    wind.paths.attr('d', line);
    wind.heads.attr('d', function (l) {
      var a = P(l[l.length - 3][0], l[l.length - 3][1]), b = P(l[l.length - 1][0], l[l.length - 1][1]);
      var ang = Math.atan2(b[1] - a[1], b[0] - a[0]), r = 6;
      var p1 = [b[0] - r * Math.cos(ang - 0.45), b[1] - r * Math.sin(ang - 0.45)], p2 = [b[0] - r * Math.cos(ang + 0.45), b[1] - r * Math.sin(ang + 0.45)];
      return 'M' + p1[0].toFixed(1) + ',' + p1[1].toFixed(1) + 'L' + b[0].toFixed(1) + ',' + b[1].toFixed(1) + 'L' + p2[0].toFixed(1) + ',' + p2[1].toFixed(1);
    });
  }

  /* ------------------------------------------------------------ labels, graticule, focus, scale, locator */
  function riverAnchor(name, lon, lat) {
    var f = F.rivers.filter(function (r) { return r.properties.name === name; })[0];
    if (!f) return null;
    var best = null, bd = Infinity, lines = f.geometry.type === 'LineString' ? [f.geometry.coordinates] : f.geometry.coordinates;
    lines.forEach(function (ln) { ln.forEach(function (c) { var d = (c[0] - lon) * (c[0] - lon) + (c[1] - lat) * (c[1] - lat); if (d < bd) { bd = d; best = c; } }); });
    return best;
  }
  var RIVERS = [['Sutlej', 75.75, 31.0], ['Beas', 75.35, 31.55], ['Ravi', 75.25, 32.15], ['Yamuna', 77.25, 29.6], ['Chenab', 74.1, 32.35]]
    .map(function (r) { var a = riverAnchor(r[0], r[1], r[2]); return a ? { name: r[0], lon: a[0], lat: a[1] } : null; }).filter(Boolean);
  function labelsFor(kind) {
    var cityL = function (n, dx, dy, anchor) {
      var c = D.cities.filter(function (x) { return x.name === n; })[0];
      return c ? { id: 'c-' + n, lon: c.lon, lat: c.lat, text: n, cls: 'map-label city', dot: true, dx: dx === undefined ? 6 : dx, dy: dy === undefined ? -6 : dy, anchor: anchor || 'start' } : null;
    };
    var area = function (id, text, lon, lat, cls) { return { id: id, lon: lon, lat: lat, text: text, cls: 'map-label ' + cls, dx: 0, dy: 0, anchor: 'middle' }; };
    var riverL = function (names) {
      return RIVERS.filter(function (r) { return names.indexOf(r.name) >= 0; })
        .map(function (r) { return { id: 'r-' + r.name, lon: r.lon, lat: r.lat, text: r.name, cls: 'map-label river', dx: 5, dy: -5, anchor: 'start' }; });
    };
    var out = [];
    if (kind === 'wide') out = [area('a-in', 'India', 78.6, 21.8, 'country'), area('a-pk', 'Pakistan', 68.9, 27.4, 'country-minor'), area('a-np', 'Nepal', 84.3, 28.1, 'country-minor'),
      area('a-as', 'Arabian Sea', 67.6, 15.0, 'water'), area('a-bb', 'Bay of Bengal', 88.8, 16.0, 'water'), cityL('Delhi', 7, 4), area('a-pb', 'Punjab', 72.6, 31.4, 'state-key')];
    else if (kind === 'north') out = [area('a-in', 'India', 80.5, 24.6, 'country'), area('a-pk', 'Pakistan', 69.6, 28.6, 'country-minor'), area('a-np', 'Nepal', 84.3, 28.1, 'country-minor'),
      cityL('Delhi', 7, 4), area('a-pb', 'Punjab', 72.7, 31.4, 'state-key')];
    else if (kind === 'plain') out = [cityL('Delhi', 7, 4), cityL('Chandigarh', 7, -5), cityL('Lahore', -7, -5, 'end'), area('a-pk', 'Pakistan', 72.9, 29.7, 'country-minor'),
      area('s-pb', 'Punjab', 74.75, 30.45, 'state'), area('s-hr', 'Haryana', 76.25, 29.25, 'state-minor'), area('s-hp', 'Himachal Pradesh', 77.35, 31.85, 'state-minor'),
      area('s-rj', 'Rajasthan', 74.0, 28.0, 'state-minor')].concat(riverL(['Sutlej', 'Beas', 'Ravi', 'Yamuna', 'Chenab']));
    else if (kind === 'punjab') out = [cityL('Amritsar'), cityL('Jalandhar'), cityL('Ludhiana'), cityL('Bathinda', 6, 14), cityL('Patiala', 6, 12), cityL('Chandigarh', 6, -6),
      area('a-pk', 'Pakistan', 74.25, 30.75, 'country-minor')].concat(riverL(['Sutlej', 'Beas', 'Ravi']));
    else if (kind === 'six') {
      var nudge = { 'Ludhiana': [0, -4], 'Moga': [-4, 0], 'Barnala': [-2, 2], 'Sangrur': [0, 8], 'Patiala': [6, 10], 'Fatehgarh Sahib': [4, -8] };
      out = F.districts.map(function (f) {
        var c = d3.geoCentroid(f), n = f.properties.name, d = nudge[n] || [0, 0];
        return { id: 'd-' + n, lon: c[0], lat: c[1], text: n, cls: 'map-label district' + (f.properties.six ? ' six' : ''), dx: d[0], dy: d[1], anchor: 'middle' };
      });
    }
    return out.filter(Boolean);
  }

  function drawOverlay() {
    if (!cam || active < 0) return;
    var s = STEPS[active], items = labelsFor(s.labels).filter(function (d) {
      var p = P(d.lon, d.lat); return p[0] > -40 && p[0] < W + 40 && p[1] > -20 && p[1] < H + 20;
    });
    var sel = gLabels.selectAll('g.lab').data(items, function (d) { return d.id; });
    sel.exit().remove();
    var en = sel.enter().append('g').attr('class', 'lab');
    en.append('circle').attr('r', 3);
    en.append('text');
    sel.merge(en)
      .attr('transform', function (d) { var p = P(d.lon, d.lat); return 'translate(' + p[0].toFixed(1) + ',' + p[1].toFixed(1) + ')'; })
      .each(function (d) {
        var g = d3.select(this);
        g.select('circle').style('display', d.dot ? null : 'none').attr('class', 'map-dot');
        g.select('text').attr('class', d.cls).attr('x', d.dx).attr('y', d.dy).attr('dy', '0.32em').attr('text-anchor', d.anchor).text(d.text);
      });

    gGrat.selectAll('*').remove();
    if (s.grat) {
      var step = s.grat, lon0 = (-cam.tx / cam.k) / C, lon1 = ((W - cam.tx) / cam.k) / C, latTop = cam.ty / cam.k, latBot = (cam.ty - H) / cam.k;
      var dec = step < 1 ? (step < 0.5 ? 1 : 1) : 0, topOff = narrowMQ.matches ? 26 : 0;
      for (var lo = Math.ceil(lon0 / step) * step; lo <= lon1; lo += step) {
        var x = P(lo, 0)[0];
        gGrat.append('line').attr('class', 'grat').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', H);
        gGrat.append('text').attr('class', 'map-label small').attr('x', x + 4).attr('y', 16 + topOff).text(lo.toFixed(dec) + '\u00b0 E');
      }
      for (var la = Math.ceil(latBot / step) * step; la <= latTop; la += step) {
        var y = P(0, la)[1];
        gGrat.append('line').attr('class', 'grat').attr('x1', 0).attr('x2', W).attr('y1', y).attr('y2', y);
        gGrat.append('text').attr('class', 'map-label small').attr('x', 6).attr('y', y - 5).text(la.toFixed(dec) + '\u00b0 N');
      }
    }

    gFocus.selectAll('*').remove();
    if (s.focus && !(s.photo && assets.photo)) {
      var f = focusPoint(), fp = P(f.lon, f.lat);
      [[fp[0], 0, fp[0], H], [0, fp[1], W, fp[1]]].forEach(function (l) {
        gFocus.append('line').attr('class', 'crosshair').attr('x1', l[0]).attr('y1', l[1]).attr('x2', l[2]).attr('y2', l[3]);
      });
      gFocus.append('circle').attr('class', 'target').attr('cx', fp[0]).attr('cy', fp[1]).attr('r', 9);
      var left = fp[0] + 250 > W, tx = left ? fp[0] - 14 : fp[0] + 14;
      var t = gFocus.append('text').attr('class', 'map-label readout').attr('text-anchor', left ? 'end' : 'start').attr('x', tx).attr('y', fp[1] - 12 - (f.lines.length - 1) * 16);
      f.lines.forEach(function (l, i) { t.append('tspan').attr('x', tx).attr('dy', i ? 16 : 0).style('font-weight', i ? null : 600).text(l); });
    }

    gScale.selectAll('*').remove();
    var pxPerKm = cam.k / KM_PER_DEG, nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], km = nice[0];
    nice.forEach(function (n) { if (n * pxPerKm <= 110) km = n; });
    var bw = km * pxPerKm, bx = W - bw - 20, by = H - (narrowMQ.matches ? H * 0.46 : 26);
    gScale.append('rect').attr('class', 'scalebar').attr('x', bx).attr('y', by).attr('width', bw).attr('height', 3);
    gScale.append('text').attr('class', 'map-label small').attr('x', bx + bw).attr('y', by - 7).attr('text-anchor', 'end').text(km + ' km');
  }

  var insetCache = {};
  function drawInset() {
    gInset.selectAll('*').remove();
    if (!cam || active < 0 || !STEPS[active].inset) return;
    var mob = narrowMQ.matches, size = mob ? 84 : 116, pad = 8;
    var b = BOUNDS.punjab, bx0 = b[0][0] * C, bx1 = b[1][0] * C, by0 = -b[1][1], by1 = -b[0][1];
    var k = Math.min((size - 2 * pad) / (bx1 - bx0), (size - 2 * pad) / (by1 - by0));
    var ox = (size - k * (bx1 - bx0)) / 2, oy = (size - k * (by1 - by0)) / 2;
    var proj = function (lon, lat) { return [ox + k * (lon * C - bx0), oy + k * (-lat - by0)]; };
    var insetPunjabPath = insetCache[size] || (insetCache[size] = d3.geoPath(d3.geoTransform({ point: function (lon, lat) { var p = proj(lon, lat); this.stream.point(p[0], p[1]); } })));
    var x = mob ? W - size - 12 : 20, y = mob ? 12 : H - size - 44;
    var g = gInset.attr('transform', 'translate(' + x + ',' + y + ')');
    g.append('rect').attr('class', 'inset-bg').attr('width', size).attr('height', size);
    g.append('path').attr('class', 'inset-pb').attr('d', insetPunjabPath(punjab));
    g.append('path').attr('class', 'inset-six').attr('d', insetPunjabPath(sixFeatures));
    var lonL = (-cam.tx / cam.k) / C, lonR = ((W - cam.tx) / cam.k) / C, latT = cam.ty / cam.k, latB = (cam.ty - H) / cam.k;
    var a = proj(lonL, latT), c = proj(lonR, latB);
    var rx = clamp(a[0], 0, size), ry = clamp(a[1], 0, size), rw = clamp(c[0], 0, size) - rx, rh = clamp(c[1], 0, size) - ry;
    g.append('rect').attr('class', 'inset-view').attr('x', rx).attr('y', ry).attr('width', Math.max(2, rw)).attr('height', Math.max(2, rh));
    g.append('text').attr('class', 'map-label small').attr('x', 4).attr('y', size + 14).text('Punjab');
  }

  function focusPoint() {
    var b = fires.B, inField = function (p) { return p.lon >= FIELD[0] && p.lon <= FIELD[2] && p.lat >= FIELD[1] && p.lat <= FIELD[3]; };
    if (b && b.pts.length) {
      var pool = b.pts.filter(inField);
      if (!pool.length) pool = b.pts.filter(function (p) { return p.district === 'Sangrur'; });
      if (!pool.length) pool = b.pts;
      var best = pool.reduce(function (m, p) { return p.frp > m.frp ? p : m; }, pool[0]);
      var key = b.season + ':' + best.lon + ':' + best.lat;
      if (!focus || focus.key !== key) {
        var dt = seasonDate(b.season, best.day), hh = Math.floor(best.min / 60), mm = best.min % 60;
        focus = { key: key, lon: best.lon, lat: best.lat, lines: [
          best.lat.toFixed(4) + '\u00b0 N, ' + best.lon.toFixed(4) + '\u00b0 E',
          longDate(dt) + ', ' + (hh < 10 ? '0' : '') + hh + ':' + (mm < 10 ? '0' : '') + mm + ' India time',
          'VIIRS on NOAA-20' + (best.frp ? ', fire power ' + best.frp.toFixed(1) + ' MW' : '')] };
      }
      return focus;
    }
    var lon = (FIELD[0] + FIELD[2]) / 2, lat = (FIELD[1] + FIELD[3]) / 2;
    return { lon: lon, lat: lat, lines: ['Sangrur district', lat.toFixed(2) + '\u00b0 N, ' + lon.toFixed(2) + '\u00b0 E'] };
  }

  /* ------------------------------------------------------------ fire detections */
  function drawFires() {
    if (!ctx || !cam) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var set = fireState.key ? fires[fireState.key] : null;
    if (!set) return;
    var onSat = stageEl.classList.contains('on-sat');
    var k = cam.k, tx = cam.tx, ty = cam.ty, dmax = fireState.dayMax, i, p, x, y, pts = set.pts;
    var dense = pts.length > 30000 ? 0.62 : pts.length > 8000 ? 0.8 : 1, r = clamp(k / 300, 1.2, 4.5) * dense;
    ctx.globalAlpha = (onSat ? 0.95 : 0.8) * (dense < 1 ? 0.85 : 1);
    ctx.fillStyle = onSat ? '#ffb23e' : (tok('--ember') || '#b8371a');
    ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; if (p.day > dmax) break;
      if (p.day >= dmax - 1 && dmax < SEASON_DAYS - 1) continue;
      x = tx + k * p.wx; y = ty + k * p.wy;
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
    }
    ctx.fill();
    if (dmax < SEASON_DAYS - 1) {
      ctx.globalAlpha = 1; ctx.fillStyle = onSat ? '#fff3c4' : (tok('--spark') || '#ef9f2f'); ctx.beginPath();
      for (i = 0; i < pts.length; i++) {
        p = pts[i]; if (p.day > dmax) break; if (p.day < dmax - 1) continue;
        x = tx + k * p.wx; y = ty + k * p.wy;
        ctx.moveTo(x + r * 1.5, y); ctx.arc(x, y, r * 1.5, 0, 6.2832);
      }
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }
  function updateHud() {
    var s = active >= 0 ? STEPS[active] : null, set = s && s.fires && fires[s.fires];
    if (!set || s.focus) { hud.classList.remove('on'); return; }
    var dmax = fireState.dayMax, n = 0;
    while (n < set.pts.length && set.pts[n].day <= dmax) n++;
    hud.innerHTML = '<b>' + set.season + ' season</b>, 15 Sep to ' + shortDate(seasonDate(set.season, Math.min(dmax, set.lastDay))) +
      '<br><span class="hud-dot"></span>' + fmt(n) + ' fire detections, VIIRS on NOAA-20';
    hud.classList.add('on');
  }

  /* ------------------------------------------------------------ steps */
  function setStep(i) {
    if (i === active) return;
    active = i;
    stepEls.forEach(function (el, j) { el.classList.toggle('is-active', j === i); });
    var s = STEPS[i], satGroup = pickSat(s.sat), satOn = !!satGroup;
    stageEl.classList.toggle('on-sat', satOn);
    var want = {};
    s.layers.forEach(function (n) { if (!(satOn && COVERED_BY_SAT[n])) want[n] = 1; });
    Object.keys(layers).forEach(function (n) { setLayer(n, !!want[n]); });
    assets.sat.forEach(function (sat) {
      var on = satOn && sat.meta.group === satGroup;
      if (on !== sat.on) { sat.on = on; fade(sat.el, on, 650); }
    });
    fade(dimRect, satOn && s.dim, 500);
    fade(gWind, !!s.wind, 600);
    fireState.key = s.fires && fires[s.fires] ? s.fires : null;
    if (!s.scrub) fireState.dayMax = SEASON_DAYS - 1;
    canvas.style.opacity = fireState.key ? 1 : 0;
    var showPhoto = !!(s.photo && assets.photo);
    photo.classList.toggle('on', showPhoto);
    credit.classList.toggle('on-photo', showPhoto);
    var parts = [];
    if (showPhoto) parts.push(assets.photo.credit);
    else {
      if (satOn) {
        var m = assets.sat.filter(function (x) { return x.meta.group === satGroup; }).pop().meta;
        var when = m.date ? ', ' + longDate(new Date(m.date + 'T00:00:00Z')) : '';
        parts.push(m.group === 'hls' ? 'Image: NASA HLS, ' + (m.sensor || '') + when + ', via NASA GIBS.'
          : m.group === 'bm' ? 'Image: NASA Blue Marble Next Generation (MODIS composite), via NASA GIBS.'
          : 'Image: NASA GIBS, ' + (m.group === 'modis' ? 'MODIS on Terra' : 'VIIRS on Suomi NPP') + when + '.');
      }
      if (s.wind) parts.push(wind.measured ? 'Wind: NASA POWER, MERRA-2.' : 'Wind lines are schematic.');
      if (fireState.key) parts.push('Fires: NASA FIRMS, VIIRS on NOAA-20.');
      parts.push('Boundaries: INDIAN-SHAPEFILES (datta07), Natural Earth.');
    }
    credit.textContent = parts.join(' ');
    flyTo(viewFor(i));
    updateScrub();
  }
  function updateScrub() {
    if (active < 0) return;
    var s = STEPS[active];
    if (s.scrub && fireState.key) {
      var r = stepEls[active].getBoundingClientRect(), vh = window.innerHeight;
      var prog = clamp((vh * 0.62 - r.top) / (r.height * 0.8), 0, 1);
      fireState.dayMax = reduceMotion ? SEASON_DAYS - 1 : Math.round(prog * (SEASON_DAYS - 1));
      drawFires();
    }
    updateHud();
  }
  function refreshStep() { if (active >= 0) { var i = active; active = -1; setStep(i); } }
  function initStage() {
    buildStage();
    setWind(schematicField(), false);
    setStep(0);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setStep(+e.target.getAttribute('data-step')); });
    }, { rootMargin: '-50% 0px -49% 0px', threshold: 0 });
    stepEls.forEach(function (st) { io.observe(st); });
  }

  /* ------------------------------------------------------------ data written by the pipeline (all optional) */
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function loadAssets() {
    return getJSON('data/assets.json').then(function (a) {
      (a.sat || []).forEach(addSatImage);
      if (assets.field) {
        root.classList.add('hls-ready');
        put('hlsDate', longDate(new Date(assets.field.date + 'T00:00:00Z')));
        put('hlsSensor', assets.field.sensor || 'Sentinel-2');
      }
      if (a.photo && a.photo.file) {
        photo.onload = function () { assets.photo = a.photo; refreshStep(); };
        photo.src = a.photo.file;
      }
      if (assets.sat.length) { focus = null; refreshStep(); }
    }).catch(function () { /* without imagery the vector map stands on its own */ });
  }
  function loadWindField() {
    return getJSON('data/windfield.json').then(function (w) {
      if (!w || w.status !== 'ok' || !w.u || !w.v) throw new Error('no wind field');
      setWind(gridField(w), true);
      refreshStep();
    }).catch(function () { /* the schematic flow stays, and the page says so */ });
  }
  function prepSeason(js, names) {
    var ix = {};
    js.cols.forEach(function (c, i) { ix[c] = i; });
    var pts = js.rows.map(function (r) {
      return { lon: r[ix.lon], lat: r[ix.lat], day: r[ix.day], min: r[ix.min], frp: r[ix.frp] || 0, district: names[r[ix.dist]] || null, wx: r[ix.lon] * C, wy: -r[ix.lat] };
    }).sort(function (a, b) { return a.day - b.day; });
    return { season: js.season, pts: pts, lastDay: js.last_day, through: js.through, total: js.count };
  }
  function loadFires() {
    return getJSON('data/live.json').then(function (live) {
      if (!live || live.status !== 'ok' || !live.map) throw new Error('no live data');
      fires.meta = live;
      return Promise.all([getJSON(live.map.A), getJSON(live.map.B)]).then(function (pair) {
        fires.A = prepSeason(pair[0], live.districts || []);
        fires.B = prepSeason(pair[1], live.districts || []);
        root.classList.add('live-ready');
        put('countA', fmt(fires.A.total)); put('seasonB', fires.B.season); put('countB', fmt(fires.B.total));
        put('throughB', fires.B.through ? ' to ' + longDate(new Date(fires.B.through + 'T00:00:00Z')) : '');
        focus = null;
        refreshStep();
        renderLive(live);
      });
    }).catch(function () { /* the page keeps the official figures */ });
  }

  /* ------------------------------------------------------------ charts */
  function frame(el, h) {
    el.innerHTML = '';
    var w = Math.max(280, el.clientWidth);
    var svg = d3.select(el).append('svg').attr('width', w).attr('height', h).attr('viewBox', '0 0 ' + w + ' ' + h);
    return { svg: svg, w: w, h: h };
  }
  function txt(g, x, y, s, cls, anchor) {
    return g.append('text').attr('x', x).attr('y', y).attr('class', cls || null).attr('text-anchor', anchor || 'start').text(s);
  }
  var minus = function (v, dp) { return (v < 0 ? '\u2212' : '') + Math.abs(v).toFixed(dp); };

  var charts = {
    counts: function (el) {
      var w = Math.max(280, el.clientWidth), narrow = w < 640, gap = 44;
      var pw = narrow ? w : (w - gap) / 2, ph = 250, h = narrow ? ph * 2 + 36 : ph;
      var f = frame(el, h), seasons = [2021, 2022, 2023, 2024, 2025, 2026];
      var A = f.svg.append('g'), B = f.svg.append('g').attr('transform', narrow ? 'translate(0,' + (ph + 36) + ')' : 'translate(' + (pw + gap) + ',0)');
      txt(A, 0, 12, 'Official fire counts', 'lab-strong');
      var xa = d3.scaleBand().domain(seasons).range([0, pw]).paddingInner(0.3).paddingOuter(0.05);
      var ya = d3.scaleLinear().domain([0, 80000]).range([ph - 26, 40]);
      A.append('line').attr('x1', 0).attr('x2', pw).attr('y1', ya(0)).attr('y2', ya(0)).style('stroke', 'var(--rule)');
      D.counts.forEach(function (c) {
        var x = xa(c.season), bw = xa.bandwidth();
        A.append('rect').attr('x', x).attr('width', bw).attr('y', ya(c.fires)).attr('height', ya(0) - ya(c.fires)).style('fill', 'var(--ember)').style('fill-opacity', c.partial ? 0.45 : 0.9);
        txt(A, x + bw / 2, ya(c.fires) - 6, fmt(c.fires), 'lab-strong', 'middle');
        txt(A, x + bw / 2, ph - 8, c.season, null, 'middle');
        if (c.partial) txt(A, x + bw / 2, ya(c.fires) - 21, c.partial, null, 'middle');
      });
      txt(B, 0, 12, 'Burnt area, lakh hectares', 'lab-strong');
      var series = [{ m: 'PRSC', label: 'Punjab Remote Sensing Centre', dash: null, color: 'var(--ink)' },
                    { m: 'iFOREST', label: 'iFOREST, Sentinel-2', dash: '5 4', color: 'var(--ink-2)' }];
      var legendTwoLines = pw < 420, lx = 0;
      series.forEach(function (s, k) {
        var ly = legendTwoLines ? 30 + k * 16 : 30, x0 = legendTwoLines ? 0 : lx;
        B.append('line').attr('x1', x0).attr('x2', x0 + 22).attr('y1', ly - 4).attr('y2', ly - 4).style('stroke', s.color).style('stroke-width', '2px').style('stroke-dasharray', s.dash);
        var tl = txt(B, x0 + 28, ly, s.label);
        if (!legendTwoLines) lx = x0 + 28 + tl.node().getComputedTextLength() + 18;
      });
      var xb = d3.scalePoint().domain(seasons).range([14, pw - 26]);
      var yb = d3.scaleLinear().domain([0, 35]).range([ph - 26, legendTwoLines ? 64 : 50]);
      [0, 10, 20, 30].forEach(function (t) {
        B.append('line').attr('x1', 0).attr('x2', pw).attr('y1', yb(t)).attr('y2', yb(t)).style('stroke', t ? 'var(--rule-2)' : 'var(--rule)');
        if (t) txt(B, pw, yb(t) - 4, t, null, 'end');
      });
      seasons.forEach(function (s) { txt(B, xb(s), ph - 8, s, null, 'middle'); });
      series.forEach(function (s) {
        var pts = D.burnt.filter(function (b) { return b.method === s.m; });
        B.append('path').attr('d', d3.line().x(function (d) { return xb(d.season); }).y(function (d) { return yb(d.lakhHa); })(pts))
          .style('fill', 'none').style('stroke', s.color).style('stroke-width', '2px').style('stroke-dasharray', s.dash);
        pts.forEach(function (d) {
          B.append('circle').attr('cx', xb(d.season)).attr('cy', yb(d.lakhHa)).attr('r', 4.5).style('fill', d.partial ? 'var(--page)' : s.color).style('stroke', s.color).style('stroke-width', '2px');
          txt(B, xb(d.season), yb(d.lakhHa) + (s.m === 'PRSC' ? 19 : -10), d.lakhHa.toFixed(1), 'lab-strong', 'middle');
        });
      });
    },

    clock: function (el) {
      var w = Math.max(280, el.clientWidth), narrow = w < 560, m = { l: narrow ? 8 : 116, r: 16 };
      var rows = D.clock.years, rowH = 20, top = 58, gapR = narrow ? 70 : 56, step = rowH + gapR;
      var yRow = function (i) { return top + i * step + (narrow ? 18 * (i + 1) : 0); };
      var bottom = yRow(rows.length - 1) + rowH + 22, h = bottom + 40, g = frame(el, h).svg;
      var x = d3.scaleLinear().domain([6, 20]).range([m.l, w - m.r]);
      g.append('rect').attr('x', x(15)).attr('width', x(20) - x(15)).attr('y', top - 16).attr('height', bottom - top + 22).style('fill', 'var(--ember-soft)');
      txt(g, x(20) - 4, top - 22, 'after 15:00', null, 'end');
      D.clock.passes.forEach(function (p) {
        g.append('line').attr('x1', x(p.t)).attr('x2', x(p.t)).attr('y1', 18).attr('y2', bottom + 6).style('stroke', 'var(--ink)').style('stroke-width', '1.4px').style('stroke-dasharray', '3 3');
        var first = p.t === D.clock.passes[0].t;
        txt(g, x(p.t) + (first ? -6 : 6), 12, narrow ? p.label.slice(0, 5) : p.label, 'lab-strong', first ? 'end' : 'start');
      });
      rows.forEach(function (r, i) {
        var y = yRow(i);
        if (narrow) txt(g, m.l, y - 26, r.label, 'lab-strong'); else txt(g, 0, y + rowH / 2 + 4, r.label, 'lab-strong');
        g.append('rect').attr('x', x(6)).attr('width', x(20) - x(6)).attr('y', y).attr('height', rowH).style('fill', 'var(--rule-2)');
        g.append('rect').attr('x', x(15)).attr('width', x(20) - x(15)).attr('y', y).attr('height', rowH).style('fill', 'var(--ember)').style('fill-opacity', 0.2 + 0.65 * r.after3pm / 100);
        var share = (r.more ? 'more than ' : '') + r.after3pm + '%' + (narrow ? ' after 15:00' : ' of large fires after 15:00') + (r.shareYear ? ' (' + r.shareYear + ')' : '');
        txt(g, narrow ? m.l : x(20) - 2, y - 7, share, 'lab-ember', narrow ? 'start' : 'end');
        g.append('circle').attr('cx', x(r.peak)).attr('cy', y + rowH / 2).attr('r', 6.5).style('fill', 'var(--ink)').style('stroke', 'var(--clear)').style('stroke-width', '2px');
        txt(g, x(r.peak), y + rowH + 16, r.peakLabel, null, 'middle');
      });
      [6, 9, 12, 15, 18].forEach(function (t) { txt(g, x(t), h - 8, (t < 10 ? '0' : '') + t + ':00', null, t === 6 ? 'start' : 'middle'); });
    },

    costs: function (el) {
      var w = Math.max(280, el.clientWidth), narrow = w < 560, m = { l: narrow ? 8 : 168, r: 74 }, rowH = narrow ? 58 : 44, top = 34;
      var h = top + D.costs.length * rowH + 30, g = frame(el, h).svg;
      var x = d3.scaleLinear().domain([0, 3000]).range([m.l, w - m.r]);
      [0, 1000, 2000, 3000].forEach(function (t) {
        g.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', top - 6).attr('y2', h - 24).style('stroke', 'var(--rule-2)');
        txt(g, x(t), h - 8, inr(t), null, 'middle');
      });
      g.append('line').attr('x1', x(2500)).attr('x2', x(2500)).attr('y1', top - 10).attr('y2', h - 24).style('stroke', 'var(--field)').style('stroke-width', '2px');
      txt(g, x(2500), top - 16, 'Contract: \u20b92,500 an acre', 'lab-strong', 'middle').style('fill', 'var(--field)');
      D.costs.forEach(function (c, i) {
        var y = top + i * rowH + rowH / 2 + (narrow ? 8 : 0), lx = x(Math.max(c.p75, 2500)) + 8;
        if (narrow) txt(g, m.l, y - 16, c.route + ', ' + c.detail, 'lab-strong');
        else { txt(g, 0, y - 2, c.route, 'lab-strong'); txt(g, 0, y + 13, c.detail); }
        g.append('line').attr('x1', x(c.p25)).attr('x2', x(c.p75)).attr('y1', y).attr('y2', y).style('stroke', 'var(--ink-2)').style('stroke-width', '3px');
        g.append('circle').attr('cx', x(c.med)).attr('cy', y).attr('r', 5.5).style('fill', 'var(--ink)');
        txt(g, lx, y + 4, inr(c.med), 'lab-strong');
        txt(g, lx, y + 18, 'n = ' + c.n);
      });
    },

    trial: function (el) {
      var w = Math.max(280, el.clientWidth), narrow = w < 560, m = { l: narrow ? 8 : 180, r: 16 }, rowH = 30, groupGap = 30, top = 22;
      var rows = D.trial, h = top + rows.length * rowH + 2 * groupGap + 40, g = frame(el, h).svg;
      var x = d3.scaleLinear().domain([-10, 22]).range([m.l, w - m.r]);
      var y = 0, last = null, titles = [];
      rows.forEach(function (r) {
        if (r.measure !== last) { y += last ? groupGap : 0; last = r.measure; titles.push({ title: r.measure, y: top + y }); y += 20; }
        r._y = top + y + rowH / 2; y += rowH;
      });
      [-10, -5, 0, 5, 10, 15, 20].forEach(function (t) {
        g.append('line').attr('x1', x(t)).attr('x2', x(t)).attr('y1', top - 4).attr('y2', h - 26).style('stroke', t === 0 ? 'var(--ink-2)' : 'var(--rule-2)').style('stroke-width', t === 0 ? '1.2px' : '1px');
        txt(g, x(t), h - 8, (t > 0 ? '+' : '') + minus(t, 0), null, 'middle');
      });
      titles.forEach(function (p) { txt(g, narrow ? m.l : 0, p.y + 12, p.title, 'lab-strong'); });
      rows.forEach(function (r) {
        var lo = r.est - 1.96 * r.se, hi = r.est + 1.96 * r.se, adv = r.arm.indexOf('up front') >= 0, col = adv ? 'var(--field)' : 'var(--ink-3)';
        if (!narrow) txt(g, 0, r._y + 4, r.arm);
        g.append('line').attr('x1', x(lo)).attr('x2', x(hi)).attr('y1', r._y).attr('y2', r._y).style('stroke', col).style('stroke-width', '2.5px');
        g.append('circle').attr('cx', x(r.est)).attr('cy', r._y).attr('r', 5.5).style('fill', col);
        var lab = (narrow ? r.arm + ': ' : '') + (r.est > 0 ? '+' : '') + minus(r.est, 1) + ' (' + minus(lo, 1) + ' to ' + minus(hi, 1) + ')';
        var tx = x(hi) + 8, anchor = 'start';
        if (tx > w - 150) { tx = x(lo) - 8; anchor = 'end'; }
        if (narrow) { tx = m.l; anchor = 'start'; }
        txt(g, tx, narrow ? r._y - 9 : r._y + 4, lab, adv ? 'lab-strong' : null, anchor);
      });
    },

    calc: function (el) {
      var input = document.getElementById('acres'), out = document.getElementById('acres-out'), box = document.getElementById('calc-out');
      if (!input) return;
      var K = D.contract;
      var draw = function () {
        var a = +input.value, paid = Math.min(a, K.fullAcres) + 0.5 * Math.min(Math.max(a - K.fullAcres, 0), K.halfToAcres - K.fullAcres);
        var adv = K.advance * paid, fin = K.final * paid;
        out.textContent = (a % 1 ? a.toFixed(1) : a) + (a === 1 ? ' acre' : ' acres');
        box.innerHTML = '<div><div class="k">At enrolment</div><div class="v">' + inr(adv) + '</div></div>' +
          '<div><div class="k">After a clean season</div><div class="v">' + inr(fin) + '</div></div>' +
          '<div><div class="k">In total</div><div class="v">' + inr(adv + fin) + '</div></div>';
        var f = frame(el, 46), g = f.svg, x = d3.scaleLinear().domain([0, 43750]).range([0, f.w]);
        g.append('rect').attr('x', 0).attr('width', f.w).attr('y', 8).attr('height', 18).style('fill', 'var(--rule-2)');
        g.append('rect').attr('x', 0).attr('width', x(adv)).attr('y', 8).attr('height', 18).style('fill', 'var(--straw)');
        g.append('rect').attr('x', x(adv)).attr('width', x(adv + fin) - x(adv)).attr('y', 8).attr('height', 18).style('fill', 'var(--field)');
        txt(g, f.w, 42, 'most a farmer can receive: \u20b943,750', null, 'end');
      };
      if (!input._wired) { input.addEventListener('input', draw); input._wired = true; }
      draw();
    },

    pay: function (el) {
      var w = Math.max(280, el.clientWidth), narrow = w < 560, labelW = narrow ? 0 : 176, barH = 36;
      var rows = [
        { label: ['2027 season'], segs: [{ who: 'Punjab', v: 500 }, { who: 'Punjab', v: 2000 }] },
        { label: ['From 2028,', 'after the evaluation'], segs: [{ who: 'Punjab', v: 500 }, { who: 'Centre', v: 1500 }, { who: 'Delhi', v: 500 }] }
      ];
      var col = { Punjab: 'var(--field)', Centre: 'var(--centre)', Delhi: 'var(--delhi)' };
      var rowH = (narrow ? 22 : 0) + 22 + barH + 26, h = rows.length * rowH + 22;
      var g = frame(el, h).svg, x = d3.scaleLinear().domain([0, 2500]).range([labelW, w - 2]);
      rows.forEach(function (r, i) {
        var top = i * rowH, y = top + (narrow ? 22 : 0) + 22;
        if (narrow) txt(g, 0, top + 13, r.label.join(' '), 'lab-strong');
        else r.label.forEach(function (ln, k) { txt(g, 0, y + barH / 2 + 4 + (k - (r.label.length - 1) / 2) * 16, ln, 'lab-strong'); });
        [[0, 500, 'at enrolment'], [500, 2500, 'after a clean season']].forEach(function (n) {
          var a = x(n[0]) + 1, b = x(n[1]) - 3;
          g.append('path').attr('d', 'M' + a + ',' + (y - 5) + 'V' + (y - 9) + 'H' + b + 'V' + (y - 5)).style('fill', 'none').style('stroke', 'var(--ink-3)').style('stroke-width', '1px');
          var t = txt(g, (a + b) / 2, y - 13, n[2], null, 'middle');
          if (t.node().getComputedTextLength() > b - a + 8) t.text(n[1] === 500 ? 'advance' : 'final');
          var half = t.node().getComputedTextLength() / 2, cx = clamp((a + b) / 2, half + 1, w - half - 1);
          t.attr('x', cx);                    // keep the note inside the figure
        });
        var acc = 0;
        r.segs.forEach(function (sg) {
          var x0 = x(acc), x1 = x(acc + sg.v) - 2, mid = (x0 + x1) / 2;
          g.append('rect').attr('x', x0).attr('width', Math.max(0, x1 - x0)).attr('y', y).attr('height', barH).style('fill', col[sg.who]);
          var t = txt(g, mid, y + barH / 2 + 4.5, sg.who + ' ' + inr(sg.v), null, 'middle').style('font-weight', 600).style('font-size', '13px').style('fill', '#ffffff');
          if (t.node().getComputedTextLength() > x1 - x0 - 12) t.attr('y', y + barH + 15).style('fill', 'var(--ink)').style('font-size', '12px');
          acc += sg.v;
        });
      });
      txt(g, w - 2, h - 2, '\u20b92,500 an acre in total', null, 'end');
    },

    explorer: function (el) {
      var input = document.getElementById('effect-input'), out = document.getElementById('effect-out'), box = document.getElementById('effect-res');
      if (!input) return;
      var M = D.model, perPoint = M.deathsPerAcre * M.enrolledLakhAcres * 1e5 / 100;
      var deaths = function (e) { return perPoint * e; };
      var draw = function () {
        var e = +input.value, dth = deaths(e), pub = M.publicFixedCrore + M.publicPerPointCrore * e, perDeath = pub * 100 / dth;
        out.textContent = (e % 1 ? e.toFixed(1) : e) + (e === 1 ? ' point' : ' points');
        box.innerHTML = '<div><div class="k">Acres no longer burnt</div><div class="v">' + (M.enrolledLakhAcres * e / 100).toFixed(1) + ' lakh</div></div>' +
          '<div><div class="k">Early deaths averted a year</div><div class="v">about ' + fmt(roundAbout(dth)) + '</div></div>' +
          '<div><div class="k">Public money a year</div><div class="v">' + inr(pub) + ' crore</div></div>' +
          '<div><div class="k">Public money per death averted</div><div class="v">' + inr(perDeath) + ' lakh</div></div>';
        var w = Math.max(280, el.clientWidth), h = 230, m = { l: 8, r: 14, t: 22, b: 30 }, f = frame(el, h), g = f.svg;
        var x = d3.scaleLinear().domain([0, 20]).range([m.l, w - m.r]), y = d3.scaleLinear().domain([0, deaths(20)]).nice(4).range([h - m.b, m.t]);
        g.append('rect').attr('x', x(M.trialLow)).attr('width', x(M.trialHigh) - x(M.trialLow)).attr('y', m.t).attr('height', h - m.b - m.t).style('fill', 'var(--ember-soft)');
        txt(g, x(M.trialLow) + 4, m.t + 12, 'trial at \u20b9800', 'lab-ember');
        y.ticks(4).forEach(function (t) {
          g.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(t)).attr('y2', y(t)).style('stroke', t ? 'var(--rule-2)' : 'var(--rule)');
          if (t) txt(g, m.l, y(t) - 4, fmt(t) + (t === y.ticks(4).slice(-1)[0] ? ' deaths averted a year' : ''));
        });
        [0, 5, 10, 15, 20].forEach(function (t) { txt(g, x(t), h - 10, t, null, t ? (t === 20 ? 'end' : 'middle') : 'start'); });
        txt(g, w - m.r, h - 10 - 14, 'effect, percentage points', null, 'end');
        g.append('line').attr('x1', x(M.passMark)).attr('x2', x(M.passMark)).attr('y1', m.t).attr('y2', h - m.b).style('stroke', 'var(--ink-2)').style('stroke-dasharray', '3 3');
        txt(g, x(M.passMark) + 4, h - m.b - 8, 'pass mark', null, 'start');
        g.append('line').attr('x1', x(0)).attr('x2', x(20)).attr('y1', y(0)).attr('y2', y(deaths(20))).style('stroke', 'var(--ink)').style('stroke-width', '2px');
        g.append('circle').attr('cx', x(e)).attr('cy', y(dth)).attr('r', 6).style('fill', 'var(--field)');
      };
      if (!input._wired) { input.addEventListener('input', draw); input._wired = true; }
      draw();
    },

    route: function (el) {
      var w = Math.max(280, el.clientWidth), narrow = w < 640, rowH = narrow ? 40 : 28, top = 30, items = D.route;
      var h = top + items.length * rowH + 12, g = frame(el, h).svg, parse = d3.utcParse('%Y-%m-%d');
      var x = d3.scaleUtc().domain([parse('2026-11-15'), parse('2029-01-01')]).range([4, w - 4]);
      var col = { Punjab: 'var(--field)', vote: 'var(--ink-3)', eval: 'var(--ink-2)', all: 'var(--centre)' };
      [2027, 2028].forEach(function (yr) {
        var xx = x(new Date(Date.UTC(yr, 0, 1)));
        g.append('line').attr('x1', xx).attr('x2', xx).attr('y1', 6).attr('y2', h).style('stroke', 'var(--rule)');
        txt(g, xx + 4, 16, yr, 'lab-strong');
      });
      if (x(new Date(Date.UTC(2027, 0, 1))) - x(parse('2026-11-15')) > 44) txt(g, x(parse('2026-11-15')), 16, '2026', 'lab-strong');
      items.forEach(function (it, i) {
        var x0 = x(parse(it.start)), x1 = Math.max(x(parse(it.end)), x0 + 4), y = top + i * rowH + (narrow ? 16 : 0);
        g.append('rect').attr('x', x0).attr('width', x1 - x0).attr('y', y).attr('height', narrow ? 12 : 14).style('fill', col[it.who]);
        var right = x1 + 8, anchor = 'start', tx = right;
        if (narrow) { txt(g, 4, y - 4, it.label, null, 'start'); return; }
        if (right + it.label.length * 6.4 > w) { tx = x0 - 8; anchor = 'end'; }
        txt(g, tx, y + 11, it.label, null, anchor);
      });
    },

    live: function (el) {
      var live = fires.meta; if (!live || !live.cumulative) return;
      var w = Math.max(280, el.clientWidth), h = 230, m = { l: 8, r: 120, t: 14, b: 26 }, g = frame(el, h).svg;
      var cur = live.cumulative.current, cmp = live.cumulative.compare;
      var y = d3.scaleLinear().domain([0, d3.max([d3.max(cur.values) || 0, d3.max(cmp.values) || 0]) || 1]).nice(4).range([h - m.b, m.t]);
      var x = d3.scaleLinear().domain([0, SEASON_DAYS - 1]).range([m.l, w - m.r]);
      y.ticks(4).forEach(function (t) {
        g.append('line').attr('x1', m.l).attr('x2', w - m.r).attr('y1', y(t)).attr('y2', y(t)).style('stroke', t ? 'var(--rule-2)' : 'var(--rule)');
        if (t) txt(g, m.l, y(t) - 4, fmt(t));
      });
      [0, 16, 47, 76].forEach(function (d) { txt(g, x(d), h - 8, shortDate(seasonDate(2001, d)), null, d ? (d === 76 ? 'end' : 'middle') : 'start'); });
      var line = d3.line().x(function (d, i) { return x(i); }).y(function (d) { return y(d); });
      [[cmp, 'var(--ink-3)', '4 3'], [cur, 'var(--ember)', null]].forEach(function (s) {
        g.append('path').attr('d', line(s[0].values)).style('fill', 'none').style('stroke', s[1]).style('stroke-width', '2.2px').style('stroke-dasharray', s[2]);
        var n = s[0].values.length - 1;
        if (n >= 0) txt(g, x(n) + 6, y(s[0].values[n]) + 4, s[0].season + ': ' + fmt(s[0].values[n]), 'lab-strong').style('fill', s[1]);
      });
    }
  };

  function renderLive(live) {
    var sec = document.getElementById('live');
    if (!sec || !live.cumulative) return;
    var c = live.cumulative;
    sec.hidden = false;
    sec.querySelector('.live-lede').textContent = 'Satellite fire detections in Punjab since 15 September ' + c.current.season + ': ' + fmt(c.current.total) +
      '. By the same date in ' + c.compare.season + ': ' + fmt(c.compare.toDate) + '. Updated ' + (live.updated ? longDate(new Date(live.updated)) : '') + '.';
    renderChart(sec.querySelector('[data-chart="live"]'));
  }
  function renderChart(el) {
    var fn = charts[el.getAttribute('data-chart')];
    if (fn) { try { fn(el); } catch (e) { if (window.console) console.error(e); } }
  }
  function renderAll() { document.querySelectorAll('[data-chart]').forEach(renderChart); }
  function labelTables() {
    document.querySelectorAll('table.stack').forEach(function (tb) {
      var heads = Array.prototype.map.call(tb.querySelectorAll('thead th'), function (th) { return th.textContent.trim(); });
      tb.querySelectorAll('tbody tr').forEach(function (tr) {
        Array.prototype.forEach.call(tr.children, function (td, i) { if (heads[i]) td.setAttribute('data-label', heads[i]); });
      });
    });
  }

  /* ------------------------------------------------------------ sharing */
  function wireShare() {
    var url = window.location.href.split('#')[0];
    var line = 'A proposal to pay Punjab\u2019s farmers \u20b92,500 an acre for a paddy field left unburnt, \u20b9500 of it at enrolment, checked by satellite.';
    var wa = document.getElementById('share-wa'), mail = document.getElementById('share-mail');
    if (wa) wa.href = 'https://wa.me/?text=' + encodeURIComponent(line + ' ' + url);
    if (mail) mail.href = 'mailto:?subject=' + encodeURIComponent('The Clean Field Contract') + '&body=' + encodeURIComponent(line + '\n\n' + url);
    var copy = document.getElementById('share-copy');
    if (copy) copy.addEventListener('click', function () {
      var done = function () { copy.textContent = 'Link copied'; setTimeout(function () { copy.textContent = 'Copy the link'; }, 2200); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(url).then(done, function () { window.prompt('Copy this link', url); });
      else window.prompt('Copy this link', url);
    });
    var pr = document.getElementById('share-print');
    if (pr) pr.addEventListener('click', function () { window.print(); });
  }

  /* ------------------------------------------------------------ the page clears as the argument turns */
  var evidenceEl = document.getElementById('evidence'), contractEl = document.getElementById('contract');
  function updateAir() {
    if (!evidenceEl || !contractEl) return;
    var vh = window.innerHeight, a = evidenceEl.getBoundingClientRect().top, b = contractEl.getBoundingClientRect().top;
    var t = clamp((vh * 0.6 - a) / Math.max(1, b - a), 0, 1);
    root.style.setProperty('--page', d3.interpolateRgb(tok('--haze'), tok('--clear'))(t));
  }

  var ticking = false;
  window.addEventListener('scroll', function () {
    if (ticking) return;
    ticking = true;
    window.requestAnimationFrame(function () { ticking = false; updateScrub(); updateAir(); });
  }, { passive: true });
  var lastW = window.innerWidth;
  window.addEventListener('resize', function () {
    if (mapOK) resizeStage();
    if (Math.abs(window.innerWidth - lastW) > 4) { lastW = window.innerWidth; renderAll(); }
    updateAir();
  });
  var schemeMQ = window.matchMedia('(prefers-color-scheme: dark)');
  if (schemeMQ.addEventListener) schemeMQ.addEventListener('change', function () { root.style.removeProperty('--page'); updateAir(); if (mapOK) renderMap(); renderAll(); });

  labelTables();
  if (mapOK) initStage();
  renderAll();
  wireShare();
  updateAir();
  if (mapOK) { loadAssets(); loadWindField(); loadFires(); }
})();
