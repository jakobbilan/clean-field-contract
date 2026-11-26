/* The Clean Field Contract: map story, charts and controls. Needs d3 7.9, topojson-client 3.1, geo.js and data.js. */
(function () {
  'use strict';
  var D = window.CFC_DATA, G = window.CFC_GEO, d3 = window.d3, topojson = window.topojson;
  if (!D || !G || !d3 || !topojson) return;

  var root = document.documentElement;
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
  var neighbours = { type: 'FeatureCollection', features: ['HARYANA', 'DELHI', 'CHANDIGARH'].map(stateNamed).filter(Boolean) };
  var stateMesh = topojson.mesh(G, statesObj, function (a, b) { return a !== b; });
  var districtMesh = topojson.mesh(G, districtsObj, function (a, b) { return a !== b; });
  var sixFeatures = { type: 'FeatureCollection', features: F.districts.filter(function (f) { return f.properties.six; }) };
  var sixOutline = topojson.mesh(G, districtsObj, function (a, b) {
    return (a === b && a.properties.six) || (a !== b && a.properties.six !== b.properties.six);
  });
  var toWorld = d3.geoTransform({ point: function (x, y) { this.stream.point(x * C, -y); } });
  var wpath = d3.geoPath(toWorld);
  if (wpath.digits) wpath.digits(4);

  /* ------------------------------------------------------------ stage */
  var stageEl = document.getElementById('stage');
  var mapOK = !!stageEl;
  var W = 0, H = 0, dpr = 1, cam = null, flight = null, active = -1, focus = null;
  var svgBase, gWorld, gSat, gWindWorld, layer = {}, canvas, ctx, svgTop, gGrat, gLabels, gFocus, gScale, hud, credit, photo;
  var assets = { sat: [], photo: null };
  var fires = { A: null, B: null, meta: null };
  var wind = null;
  var fireState = { key: null, dayMax: SEASON_DAYS - 1 };

  var BOUNDS = {
    wide: [[64.5, 7.0], [95.5, 36.4]],
    north: [[68.5, 22.5], [89.5, 35.6]],
    plain: [[72.3, 27.4], [79.7, 33.1]],
    punjab: [[73.8, 29.5], [77.0, 32.55]],
    six: [[74.75, 29.8], [76.85, 31.2]]
  };
  var STEPS = [
    { view: 'wide', sat: true, layers: ['land', 'punjabFill'], labels: 'hero' },
    { view: 'north', sat: true, layers: ['land', 'punjabFill'], labels: 'hero' },
    { view: 'plain', sat: true, layers: ['land', 'states', 'rivers', 'punjabLine'], labels: 'plain', wind: true },
    { view: 'plain', sat: true, layers: ['land', 'states', 'rivers', 'punjabFill'], labels: 'plain' },
    { view: 'punjab', layers: ['land', 'pbBase', 'states', 'rivers', 'districts', 'punjabLine'], labels: 'cities', fires: 'A', scrub: true, grat: 1 },
    { view: 'punjab', layers: ['land', 'pbBase', 'states', 'rivers', 'districts', 'punjabLine'], labels: 'cities', fires: 'B', scrub: true, grat: 1 },
    { view: 'six', layers: ['land', 'pbBase', 'states', 'districts', 'six', 'punjabLine'], labels: 'six', fires: 'B', grat: 1 },
    { view: 'field', layers: ['land', 'pbBase', 'districts'], labels: 'none', fires: 'B', grat: 0.1, focus: true },
    { view: 'field', layers: ['land', 'pbBase', 'districts'], labels: 'none', fires: 'B', grat: 0.1, focus: true, photo: true }
  ];

  function buildStage() {
    svgBase = d3.select(stageEl).append('svg').attr('class', 'base');
    var defs = svgBase.append('defs');
    gWorld = svgBase.append('g');
    var add = function (name, datum, style) {
      var p = gWorld.append('path').datum(datum).attr('d', wpath)
        .style('vector-effect', 'non-scaling-stroke').style('fill-rule', 'evenodd')
        .style('transition', reduceMotion ? 'none' : 'opacity 600ms ease').style('opacity', 0);
      Object.keys(style).forEach(function (k) { p.style(k, style[k]); });
      layer[name] = p;
    };
    add('land', F.land, { fill: 'var(--land)', stroke: 'var(--land-line)', 'stroke-width': '0.6px' });
    gSat = gWorld.append('g').attr('class', 'sat').style('opacity', 0).style('transition', reduceMotion ? 'none' : 'opacity 700ms ease');
    add('pbBase', punjab, { fill: 'var(--clear)', stroke: 'none' });
    add('punjabFill', punjab, { fill: 'var(--punjab)', 'fill-opacity': 0.85, stroke: 'none' });
    add('six', sixFeatures, { fill: 'var(--ember-soft)', stroke: 'none' });
    add('rivers', { type: 'FeatureCollection', features: F.rivers }, { fill: 'none', stroke: 'var(--river)', 'stroke-width': '1px' });
    add('states', stateMesh, { fill: 'none', stroke: 'var(--land-line)', 'stroke-width': '0.9px', 'stroke-dasharray': '3 2' });
    add('neighbours', neighbours, { fill: 'none', stroke: 'var(--ink-2)', 'stroke-width': '0.9px' });
    add('districts', districtMesh, { fill: 'none', stroke: 'var(--ink-3)', 'stroke-width': '0.6px' });
    add('sixLine', sixOutline, { fill: 'none', stroke: 'var(--ember)', 'stroke-width': '1.6px' });
    add('punjabLine', punjab, { fill: 'none', stroke: 'var(--ink)', 'stroke-width': '1.3px' });
    // wind: radial fade for the sector, drawn in map coordinates
    var w = D.wind, cx = w.lon * C, cy = -w.lat;
    var grad = defs.append('radialGradient').attr('id', 'windfade').attr('gradientUnits', 'userSpaceOnUse')
      .attr('cx', cx).attr('cy', cy).attr('r', 4.2);
    grad.append('stop').attr('offset', '0').style('stop-color', 'var(--smoke)').style('stop-opacity', 0.55);
    grad.append('stop').attr('offset', '1').style('stop-color', 'var(--smoke)').style('stop-opacity', 0.04);
    gWindWorld = gWorld.append('g').style('opacity', 0).style('transition', reduceMotion ? 'none' : 'opacity 700ms ease');
    drawWindShape();

    canvas = document.createElement('canvas');
    canvas.style.transition = reduceMotion ? 'none' : 'opacity 500ms ease';
    canvas.style.opacity = 0;
    stageEl.appendChild(canvas);
    ctx = canvas.getContext('2d');

    svgTop = d3.select(stageEl).append('svg').attr('class', 'top');
    gGrat = svgTop.append('g');
    gLabels = svgTop.append('g');
    gFocus = svgTop.append('g');
    gScale = svgTop.append('g');

    photo = document.createElement('img');
    photo.className = 'photo';
    photo.alt = 'Rice straw burning in a harvested paddy field near Sangrur, Punjab, November 2011.';
    stageEl.appendChild(photo);
    hud = document.createElement('div'); hud.className = 'hud'; stageEl.appendChild(hud);
    credit = document.createElement('p'); credit.className = 'credit'; stageEl.appendChild(credit);
    resizeStage();
  }

  // Bearing in degrees clockwise from north, distance in degrees of latitude: offset in map units
  function offset(bearing, dist) {
    var b = bearing * Math.PI / 180;
    return [dist * Math.sin(b), -dist * Math.cos(b)];
  }
  function sectorPath(cx, cy, b0, b1, r) {
    var pts = [[cx, cy]];
    for (var b = b0; b <= b1 + 1e-9; b += (b1 - b0) / 12) { var o = offset(b, r); pts.push([cx + o[0], cy + o[1]]); }
    return 'M' + pts.map(function (p) { return p[0].toFixed(4) + ',' + p[1].toFixed(4); }).join('L') + 'Z';
  }
  function drawWindShape() {
    gWindWorld.selectAll('*').remove();
    var w = D.wind, cx = w.lon * C, cy = -w.lat;
    if (wind && wind.sectors && wind.sectors.length) {
      // wind rose: petals point the way the wind blew; length = share of hours
      var maxShare = d3.max(wind.sectors, function (s) { return s.share; }) || 1, R = 3.1;
      var rings = [0.05, 0.1, 0.15, 0.2, 0.25].filter(function (r) { return r <= maxShare * 1.05; });
      rings.forEach(function (r) {
        gWindWorld.append('circle').attr('cx', cx).attr('cy', cy).attr('r', R * r / maxShare)
          .style('fill', 'none').style('stroke', 'var(--smoke)').style('stroke-opacity', 0.55).style('stroke-dasharray', '2 3').style('vector-effect', 'non-scaling-stroke');
      });
      wind.sectors.forEach(function (s) {
        var toward = (s.from_deg + 180) % 360, r = R * s.share / maxShare;
        if (r <= 0) return;
        gWindWorld.append('path').attr('d', sectorPath(cx, cy, toward - 10.5, toward + 10.5, r))
          .style('fill', 'var(--smoke)').style('fill-opacity', 0.2 + 0.55 * s.share / maxShare)
          .style('stroke', 'var(--halo)').style('stroke-width', '0.8px').style('vector-effect', 'non-scaling-stroke');
      });
      gWindWorld.datum({ rings: rings, R: R, maxShare: maxShare });
    } else {
      // no data yet: the north-west octant, the directions a north-westerly wind blows towards
      gWindWorld.append('path').attr('d', sectorPath(cx, cy, 112.5, 157.5, 4.2)).style('fill', 'url(#windfade)');
      gWindWorld.datum(null);
    }
  }

  function resizeStage() {
    W = stageEl.clientWidth; H = stageEl.clientHeight; dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.round(W * dpr); canvas.height = Math.round(H * dpr);
    svgBase.attr('viewBox', '0 0 ' + W + ' ' + H); svgTop.attr('viewBox', '0 0 ' + W + ' ' + H);
    applyView(active >= 0 ? viewFor(active) : viewForBounds(BOUNDS.wide));
  }
  function viewForBounds(b) {
    var mob = narrowMQ.matches;
    var pl = W * 0.06, pr = W * 0.06, pt = H * (mob ? 0.1 : 0.08), pb = H * (mob ? 0.44 : 0.08);
    var x0 = b[0][0] * C, x1 = b[1][0] * C, y0 = -b[1][1], y1 = -b[0][1];
    var k = Math.min((W - pl - pr) / (x1 - x0), (H - pt - pb) / (y1 - y0));
    var sx = pl + (W - pl - pr) / 2, sy = pt + (H - pt - pb) / 2;
    var tx = sx - k * (x0 + x1) / 2, ty = sy - k * (y0 + y1) / 2;
    return [(W / 2 - tx) / k, (H / 2 - ty) / k, W / k];
  }
  function viewFor(i) {
    var s = STEPS[i];
    if (s.view === 'field') { var f = focusPoint(); return viewForBounds([[f.lon - 0.34, f.lat - 0.22], [f.lon + 0.34, f.lat + 0.22]]); }
    return viewForBounds(BOUNDS[s.view]);
  }
  function applyView(v) {
    var k = W / v[2];
    cam = { k: k, tx: W / 2 - k * v[0], ty: H / 2 - k * v[1], v: v };
    gWorld.attr('transform', 'translate(' + cam.tx + ',' + cam.ty + ') scale(' + cam.k + ')');
    drawOverlay();
    drawFires();
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
  var P = function (lon, lat) { return [cam.tx + cam.k * lon * C, cam.ty - cam.k * lat]; };
  function satVisible() { return assets.sat.length > 0 && active >= 0 && STEPS[active].sat; }

  /* ------------------------------------------------------------ overlay */
  function labelsFor(kind) {
    var city = function (n, dx, dy, anchor) {
      var c = D.cities.filter(function (x) { return x.name === n; })[0];
      return { id: 'c-' + n, lon: c.lon, lat: c.lat, text: n, cls: 'map-label city', dot: true, dx: dx || 6, dy: dy || -6, anchor: anchor || 'start' };
    };
    if (kind === 'hero') {
      var hero = [city('Delhi', 7, 4)];
      if (!satVisible()) hero.push({ id: 's-pb', lon: 72.9, lat: 31.4, text: 'Punjab', cls: 'map-label city', dx: 0, dy: 0, anchor: 'end' });
      return hero;
    }
    if (kind === 'plain') {
      return [city('Delhi', 7, 4), city('Chandigarh', 7, -5), city('Lahore', -7, -5, 'end'),
        { id: 's-pb', lon: 74.75, lat: 30.45, text: 'Punjab', cls: 'map-label city', dx: 0, dy: 0, anchor: 'middle' },
        { id: 's-hr', lon: 76.2, lat: 29.35, text: 'Haryana', cls: 'map-label small', dx: 0, dy: 0, anchor: 'middle' }];
    }
    if (kind === 'cities') return [city('Amritsar'), city('Ludhiana'), city('Bathinda', 6, 14), city('Patiala', 6, 12), city('Chandigarh', 6, -6)];
    if (kind === 'six') {
      var nudge = { 'Ludhiana': [0, -4], 'Moga': [-4, 0], 'Barnala': [-2, 2], 'Sangrur': [0, 8], 'Patiala': [6, 10], 'Fatehgarh Sahib': [4, -8] };
      return sixFeatures.features.map(function (f) {
        var c = d3.geoCentroid(f), n = f.properties.name, d = nudge[n] || [0, 0];
        return { id: 'd-' + n, lon: c[0], lat: c[1], text: n, cls: 'map-label district six', dx: d[0], dy: d[1], anchor: 'middle' };
      });
    }
    return [];
  }

  function drawOverlay() {
    if (!cam || active < 0) return;
    var s = STEPS[active], items = labelsFor(s.labels);
    // wind annotation
    if (s.wind) {
      var w = D.wind, info = gWindWorld.datum();
      items.push({ id: 'w-pt', lon: w.lon, lat: w.lat, text: '', cls: 'map-label small', dot: true, dx: 0, dy: 0, anchor: 'start' });
      if (info) {
        info.rings.forEach(function (r) {
          var o = offset(45, info.R * r / info.maxShare);
          items.push({ id: 'w-r' + r, lon: w.lon + o[0] / C, lat: w.lat - o[1], text: Math.round(r * 100) + '% of hours', cls: 'map-label small', dx: 3, dy: -3, anchor: 'start' });
        });
      } else {
        var m = offset(135, 2.6);
        items.push({ id: 'w-lab', lon: w.lon + m[0] / C + 0.15, lat: w.lat - m[1] + 0.35, text: 'North-westerly wind', cls: 'map-label small', dx: 0, dy: 0, anchor: 'start' });
      }
    }
    var sel = gLabels.selectAll('g.lab').data(items, function (d) { return d.id; });
    sel.exit().remove();
    var en = sel.enter().append('g').attr('class', 'lab');
    en.append('circle').attr('r', 3);
    en.append('text');
    sel.merge(en)
      .attr('transform', function (d) { var p = P(d.lon, d.lat); return 'translate(' + p[0] + ',' + p[1] + ')'; })
      .each(function (d) {
        var g = d3.select(this);
        g.select('circle').style('display', d.dot ? null : 'none').style('fill', 'var(--ink)').style('stroke', 'var(--halo)').style('stroke-width', '1.5px');
        g.select('text').attr('class', d.cls).attr('x', d.dx).attr('y', d.dy).attr('dy', '0.32em').attr('text-anchor', d.anchor).text(d.text);
      });

    gGrat.selectAll('*').remove();
    if (s.grat) {
      var step = s.grat, lon0 = (-cam.tx / cam.k) / C, lon1 = ((W - cam.tx) / cam.k) / C, latTop = cam.ty / cam.k, latBot = (cam.ty - H) / cam.k;
      var dec = step < 1 ? 1 : 0, topOff = narrowMQ.matches ? 26 : 0;
      for (var lo = Math.ceil(lon0 / step) * step; lo <= lon1; lo += step) {
        var x = P(lo, 0)[0];
        gGrat.append('line').attr('x1', x).attr('x2', x).attr('y1', 0).attr('y2', H).style('stroke', 'var(--ink-3)').style('stroke-opacity', 0.28).style('stroke-width', '0.6px');
        gGrat.append('text').attr('class', 'map-label small').attr('x', x + 4).attr('y', 16 + topOff).text(lo.toFixed(dec) + '\u00b0 E');
      }
      for (var la = Math.ceil(latBot / step) * step; la <= latTop; la += step) {
        var y = P(0, la)[1];
        gGrat.append('line').attr('x1', 0).attr('x2', W).attr('y1', y).attr('y2', y).style('stroke', 'var(--ink-3)').style('stroke-opacity', 0.28).style('stroke-width', '0.6px');
        gGrat.append('text').attr('class', 'map-label small').attr('x', 6).attr('y', y - 5).text(la.toFixed(dec) + '\u00b0 N');
      }
    }

    gFocus.selectAll('*').remove();
    if (s.focus && !(s.photo && assets.photo)) {
      var f = focusPoint(), fp = P(f.lon, f.lat);
      [[fp[0], 0, fp[0], H], [0, fp[1], W, fp[1]]].forEach(function (l) {
        gFocus.append('line').attr('x1', l[0]).attr('y1', l[1]).attr('x2', l[2]).attr('y2', l[3]).style('stroke', 'var(--ink)').style('stroke-opacity', 0.55).style('stroke-width', '0.8px');
      });
      gFocus.append('circle').attr('cx', fp[0]).attr('cy', fp[1]).attr('r', 9).style('fill', 'none').style('stroke', 'var(--ember)').style('stroke-width', '2px');
      var left = fp[0] + 244 > W, tx = left ? fp[0] - 14 : fp[0] + 14;
      var t = gFocus.append('text').attr('class', 'map-label readout').attr('text-anchor', left ? 'end' : 'start').attr('x', tx).attr('y', fp[1] - 12 - (f.lines.length - 1) * 16);
      f.lines.forEach(function (l, i) { t.append('tspan').attr('x', tx).attr('dy', i ? 16 : 0).style('font-weight', i ? null : 650).text(l); });
    }

    gScale.selectAll('*').remove();
    var pxPerKm = cam.k / KM_PER_DEG, nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000], km = nice[0];
    nice.forEach(function (n) { if (n * pxPerKm <= 110) km = n; });
    var bw = km * pxPerKm, bx = W - bw - 18, by = H - (narrowMQ.matches ? H * 0.46 : 22);
    var col = satVisible() ? '#f4f6f5' : 'var(--ink)';
    gScale.append('rect').attr('x', bx).attr('y', by).attr('width', bw).attr('height', 3).style('fill', col);
    gScale.append('text').attr('class', 'map-label small').attr('x', bx + bw).attr('y', by - 6).attr('text-anchor', 'end').text(km + ' km');
  }

  function focusPoint() {
    var b = fires.B;
    if (b && b.pts.length) {
      var sang = b.pts.filter(function (p) { return p.district === 'Sangrur'; });
      var pool = sang.length ? sang : b.pts;
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
    var f = F.districts.filter(function (d) { return d.properties.name === 'Sangrur'; })[0];
    var c = f ? d3.geoCentroid(f) : [75.84, 30.25];
    return { lon: c[0], lat: c[1], lines: ['Sangrur district', 'centre ' + c[1].toFixed(2) + '\u00b0 N, ' + c[0].toFixed(2) + '\u00b0 E'] };
  }

  /* ------------------------------------------------------------ fire detections */
  function drawFires() {
    if (!ctx || !cam) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);
    var set = fireState.key ? fires[fireState.key] : null;
    if (!set) return;
    var k = cam.k, tx = cam.tx, ty = cam.ty, r = clamp(k / 300, 1.1, 4.5), dmax = fireState.dayMax, i, p, x, y, pts = set.pts;
    ctx.globalAlpha = 0.78; ctx.fillStyle = tok('--ember') || '#c43d1c'; ctx.beginPath();
    for (i = 0; i < pts.length; i++) {
      p = pts[i]; if (p.day > dmax) break;
      if (p.day >= dmax - 1 && dmax < SEASON_DAYS - 1) continue;
      x = tx + k * p.wx; y = ty + k * p.wy;
      if (x < -5 || y < -5 || x > W + 5 || y > H + 5) continue;
      ctx.moveTo(x + r, y); ctx.arc(x, y, r, 0, 6.2832);
    }
    ctx.fill();
    if (dmax < SEASON_DAYS - 1) {
      ctx.globalAlpha = 0.95; ctx.fillStyle = tok('--spark') || '#ef9f2f'; ctx.beginPath();
      for (i = 0; i < pts.length; i++) {
        p = pts[i]; if (p.day > dmax) break; if (p.day < dmax - 1) continue;
        x = tx + k * p.wx; y = ty + k * p.wy;
        ctx.moveTo(x + r * 1.4, y); ctx.arc(x, y, r * 1.4, 0, 6.2832);
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
    hud.innerHTML = '<b>' + set.season + ' season</b>, 15 Sep to ' + shortDate(seasonDate(set.season, Math.min(dmax, set.lastDay))) + '<br>' + fmt(n) + ' fire detections';
    hud.classList.add('on');
  }

  /* ------------------------------------------------------------ steps */
  var steps = Array.prototype.slice.call(document.querySelectorAll('.step'));
  function setStep(i) {
    if (i === active) return;
    active = i;
    var s = STEPS[i], useSat = satVisible(), on = {};
    stageEl.classList.toggle('on-sat', useSat);
    s.layers.forEach(function (n) { on[n] = 1; });
    if (on.six) on.sixLine = 1;
    if (s.view === 'plain') on.neighbours = 1;
    if (useSat) { on.land = 0; on.punjabFill = 0; on.punjabLine = 1; }
    Object.keys(layer).forEach(function (n) { layer[n].style('opacity', on[n] ? 1 : 0); });
    layer.punjabLine.style('stroke', useSat ? '#f4f6f5' : 'var(--ink)');
    layer.neighbours.style('stroke', useSat ? 'rgba(244,246,245,0.8)' : 'var(--ink-2)');
    gSat.style('opacity', useSat ? 1 : 0);
    gWindWorld.style('opacity', s.wind ? 1 : 0);
    fireState.key = s.fires && fires[s.fires] ? s.fires : null;
    if (!s.scrub) fireState.dayMax = SEASON_DAYS - 1;
    canvas.style.opacity = fireState.key ? 1 : 0;
    var showPhoto = !!(s.photo && assets.photo);
    photo.classList.toggle('on', showPhoto);
    credit.classList.toggle('on-photo', showPhoto);
    var parts = [];
    if (showPhoto) parts.push(assets.photo.credit);
    else {
      if (useSat) parts.push('Satellite image: NASA GIBS, VIIRS on Suomi NPP, 11 November 2021.');
      if (s.wind && wind) parts.push('Wind: NASA POWER, MERRA-2.');
      if (fireState.key) parts.push('Fire detections: NASA FIRMS, VIIRS on NOAA-20.');
      if (!useSat) parts.push('Boundaries: INDIAN-SHAPEFILES (datta07), Natural Earth.');
    }
    credit.textContent = parts.join(' ');
    flyTo(viewFor(i));
    updateScrub();
  }
  function updateScrub() {
    if (active < 0) return;
    var s = STEPS[active];
    if (s.scrub && fireState.key) {
      var r = steps[active].getBoundingClientRect(), vh = window.innerHeight;
      var prog = clamp((vh * 0.62 - r.top) / (r.height * 0.8), 0, 1);
      fireState.dayMax = reduceMotion ? SEASON_DAYS - 1 : Math.round(prog * (SEASON_DAYS - 1));
      drawFires();
    }
    updateHud();
  }
  function refreshStep() { if (active >= 0) { var i = active; active = -1; setStep(i); } }
  function initStage() {
    buildStage();
    setStep(0);
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) setStep(+e.target.getAttribute('data-step')); });
    }, { rootMargin: '-50% 0px -49% 0px', threshold: 0 });
    steps.forEach(function (st) { io.observe(st); });
  }

  /* ------------------------------------------------------------ optional data written by the pipeline */
  function getJSON(url) {
    return fetch(url, { cache: 'no-cache' }).then(function (r) { if (!r.ok) throw new Error(url + ' ' + r.status); return r.json(); });
  }
  function loadAssets() {
    return getJSON('data/assets.json').then(function (a) {
      (a.sat || []).forEach(function (s) {
        var b = s.bounds;
        gSat.append('image').attr('href', s.file).attr('preserveAspectRatio', 'none')
          .attr('x', b[0] * C).attr('y', -b[3]).attr('width', (b[2] - b[0]) * C).attr('height', b[3] - b[1]);
        assets.sat.push(s);
      });
      if (a.photo && a.photo.file) {
        photo.onload = function () { assets.photo = a.photo; refreshStep(); };
        photo.src = a.photo.file;
      }
      if (assets.sat.length) refreshStep();
    }).catch(function () { /* without imagery the vector map stands on its own */ });
  }
  function loadWind() {
    return getJSON('data/wind.json').then(function (w) {
      if (!w || w.status !== 'ok' || !w.sectors) throw new Error('no wind');
      wind = w;
      root.classList.add('wind-ready');
      drawWindShape();
      refreshStep();
    }).catch(function () { /* the north-west sector stays */ });
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
        var put = function (k, v) { document.querySelectorAll('[data-live="' + k + '"]').forEach(function (el) { el.textContent = v; }); };
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
        if (t) txt(B, 0, yb(t) - 4, t);
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
        txt(g, x(p.t), 12, narrow ? p.label.slice(0, 5) : p.label, 'lab-strong', 'middle');
      });
      rows.forEach(function (r, i) {
        var y = yRow(i);
        if (narrow) txt(g, m.l, y - 26, r.label, 'lab-strong'); else txt(g, 0, y + rowH / 2 + 4, r.label, 'lab-strong');
        g.append('rect').attr('x', x(6)).attr('width', x(20) - x(6)).attr('y', y).attr('height', rowH).style('fill', 'var(--rule-2)');
        g.append('rect').attr('x', x(15)).attr('width', x(20) - x(15)).attr('y', y).attr('height', rowH).style('fill', 'var(--ember)').style('fill-opacity', 0.2 + 0.65 * r.after3pm / 100);
        var share = (r.more ? 'more than ' : '') + r.after3pm + '%' + (narrow ? ' after 15:00' : ' of large fires after 15:00') + (r.shareYear ? ' (' + r.shareYear + ')' : '');
        txt(g, narrow ? m.l : x(15) + 6, y - 7, share, 'lab-ember');
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
      var w = Math.max(280, el.clientWidth), narrow = w < 560, m = { l: narrow ? 0 : 200, r: 10 }, rowH = 40, top = 8, gap = narrow ? 44 : 30;
      var h = top + 2 * rowH + gap + (narrow ? 60 : 36), g = frame(el, h).svg;
      var x = d3.scaleLinear().domain([0, 2500]).range([m.l, w - m.r]);
      var col = { Punjab: 'var(--field)', Centre: 'var(--centre)', Delhi: 'var(--delhi)' };
      [{ label: '2027 season', segs: [{ who: 'Punjab', v: 500, note: 'at enrolment' }, { who: 'Punjab', v: 2000, note: 'after a clean season' }] },
       { label: 'From 2028, after the evaluation', segs: [{ who: 'Punjab', v: 500, note: 'at enrolment' }, { who: 'Centre', v: 1500 }, { who: 'Delhi', v: 500 }] }]
        .forEach(function (r, i) {
          var y = top + i * (rowH + gap) + (narrow ? 18 : 0), acc = 0;
          if (narrow) txt(g, 0, y - 6, r.label, 'lab-strong'); else txt(g, 0, y + rowH / 2 + 4, r.label, 'lab-strong');
          r.segs.forEach(function (s) {
            var x0 = x(acc), x1 = x(acc + s.v), wide = x1 - x0 > 96;
            g.append('rect').attr('x', x0).attr('width', Math.max(0, x1 - x0 - 2)).attr('y', y).attr('height', rowH).style('fill', col[s.who]);
            txt(g, x0 + 6, wide ? y + rowH / 2 + 4 : y + rowH + 15, s.who + ' ' + inr(s.v)).style('fill', wide ? 'var(--clear)' : 'var(--ink)').style('font-weight', 600);
            if (s.note && x1 - x0 > 180) txt(g, x0 + 6, y + rowH / 2 + 18, s.note).style('fill', 'var(--clear)').style('font-size', '11px');
            acc += s.v;
          });
        });
      txt(g, x(2500), h - 4, '\u20b92,500 an acre in total', null, 'end');
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
  if (schemeMQ.addEventListener) schemeMQ.addEventListener('change', function () { root.style.removeProperty('--page'); updateAir(); drawFires(); renderAll(); });

  labelTables();
  if (mapOK) initStage();
  renderAll();
  wireShare();
  updateAir();
  if (mapOK) { loadAssets(); loadWind(); loadFires(); }
})();
