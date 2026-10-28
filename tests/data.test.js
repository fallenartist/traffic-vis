import test from 'node:test';
import assert from 'node:assert/strict';
import { allocate, nodes, modes, flows, summarize, validateFlows, createDemoFlows, validateConservation, TRAFFIC_MULTIPLIER } from '../src/data.js';
import { portLayout, buildBatches, buildNodeGuides, elevateNodeGuides, mastTipHeight, recolor, nodeDirections, connectionDirections, snapDirection, ribbonCurve, HEIGHT_SCALE, MAST_HEADROOM, NODE_NECK_FRACTION, NODE_NECK_LENGTH } from '../src/geometry.js';
import { ribbonElevation, MIN_RIBBON_ELEVATION, BUILDING_CLEARANCE } from '../src/elevation.js';

test('integer allocation preserves source totals without fractional vehicles', () => {
  assert.deepEqual(allocate(5, [1, 1, 1]), [2, 2, 1]);
  assert.deepEqual(allocate(0, [1, 2]), [0, 0]);
  assert.deepEqual(allocate(50, []), []);
  const rynek = summarize(flows, 'rynek');
  modes.forEach((mode, i) => {
    assert.equal(rynek[mode.id].incoming, nodes[0].counts[i] * TRAFFIC_MULTIPLIER);
    assert.equal(rynek[mode.id].outgoing, nodes[0].counts[i] * TRAFFIC_MULTIPLIER);
  });
});

test('all seven nodes conserve every mode, with no unaccounted sources or sinks', () => {
  for (const node of nodes) {
    const summary = summarize(flows, node.id);
    for (const mode of modes) {
      assert.ok(summary[mode.id].incoming > 0);
      assert.equal(summary[mode.id].incoming, summary[mode.id].outgoing, `${node.id}/${mode.id}`);
    }
  }
  modes.forEach((mode, i) => assert.equal(summarize(flows, 'trynek')[mode.id].incoming, nodes[0].counts[i] * TRAFFIC_MULTIPLIER));
});

test('increased traffic reaches every existing link and mode while retaining the same graph', () => {
  const before = new Map(createDemoFlows(1).map(f => [f.id, f.value]));
  assert.equal(before.size, flows.length);
  for (const f of flows) assert.ok(f.value > before.get(f.id), `${f.id} did not increase`);
  const source = summarize(flows, 'rynek');
  assert.deepEqual(modes.map(m => source[m.id].outgoing), [1000, 500, 300, 200]);
});

test('all mode totals reconcile across incoming and outgoing link counts', () => {
  const total = summarize(flows);
  for (const mode of modes) {
    const summaries = nodes.map(n => summarize(flows, n.id)[mode.id]);
    assert.equal(summaries.reduce((s, n) => s + n.incoming, 0), total[mode.id].total);
    assert.equal(summaries.reduce((s, n) => s + n.outgoing, 0), total[mode.id].total);
  }
  assert.equal(flows.length, 44);
  assert.equal(new Set(flows.map(f => `${f.source}/${f.target}`)).size, 11);
  assert.deepEqual(flows.filter(f => f.circulationReturn).map(f => [f.source, f.target, f.value]),
    [['trynek', 'rynek', 1000], ['trynek', 'rynek', 500], ['trynek', 'rynek', 300], ['trynek', 'rynek', 200]]);
});

test('bad OD data is rejected instead of silently drawing incorrect values', () => {
  for (const change of [{ target: 'missing' }, { value: -1 }, { value: 2.5 }, { value: NaN }, { mode: 'plane' }, { target: flows[0].source }]) {
    assert.throws(() => validateFlows([{ ...flows[0], ...change }]));
  }
  assert.throws(() => validateFlows([flows[0], flows[0]]));
  assert.throws(() => validateConservation(flows.slice(1)), /Unbalanced circulation/);
  assert.throws(() => validateConservation(flows.map((f, i) => i === 0 ? { ...f, value: f.value + 1 } : f)), /Unbalanced circulation/);
});

test('ports preserve thickness at both ends and never overlap arrivals or departures', () => {
  const ports = portLayout(flows);
  for (const flow of flows) assert.equal(ports.get(flow.id).thickness, flow.value * HEIGHT_SCALE);
  for (const node of nodes) for (const side of ['source', 'target']) {
    const intervals = flows.filter(f => f[side] === node.id).map(f => {
      const p = ports.get(f.id);
      const start = side === 'source' ? p.start : p.end;
      return [start, start + p.thickness];
    }).sort((a, b) => a[0] - b[0]);
    if (intervals.length) assert.equal(intervals[0][0], 0);
    for (let i = 1; i < intervals.length; i++) assert.ok(Math.abs(intervals[i][0] - intervals[i - 1][1]) < 1e-9);
  }
});

test('both 3D bearing modes batch to four meshes with finite coordinates and correct picking metadata', () => {
  const points = new Map(nodes.map(n => [n.id, { x: n.coords[0] * 70000, y: n.coords[1] * 110000 }]));
  for (const bearing of ['shared', 'snapped']) {
    const meshes = buildBatches(flows, points, bearing);
    assert.equal(meshes.length, 4);
    assert.equal(meshes.flatMap(m => m.userData.ranges).length, flows.length);
    for (const mesh of meshes) {
      const p = mesh.geometry.getAttribute('position');
      assert.ok(p.array.every(Number.isFinite));
      assert.equal(p.count / 3, mesh.userData.faces.length);
      for (const { flow, start, ribbonVertexCount } of mesh.userData.ranges) {
        const last = start + ribbonVertexCount - 6;
        const distance = (a, b) => Math.hypot(p.getX(a) - p.getX(b), p.getY(a) - p.getY(b), p.getZ(a) - p.getZ(b));
        const thickness = flow.value * HEIGHT_SCALE;
        // Float32 buffers retain adequate precision in local scene coordinates.
        const tolerance = 0.001;
        assert.ok(Math.abs(distance(start, start + 2) - thickness) < tolerance);
        assert.ok(Math.abs(distance(last + 1, last + 5) - thickness) < tolerance);
      }
      const before = mesh.geometry;
      recolor([mesh], mesh.userData.mode.id, 'rynek');
      assert.equal(mesh.geometry, before);
      assert.equal(mesh.visible, true);
      mesh.geometry.dispose(); mesh.material.dispose();
    }
  }
});

test('directions partition a common mode band, shared by arrivals and departures', () => {
  const example = [
    { id: 'in-car', source: 'origin', target: 'point', mode: 'car', value: 1000 },
    { id: 'a', source: 'point', target: 'a', mode: 'car', value: 200 },
    { id: 'b', source: 'point', target: 'b', mode: 'car', value: 300 },
    { id: 'c', source: 'point', target: 'c', mode: 'car', value: 500 },
    { id: 'in-bus', source: 'origin', target: 'point', mode: 'bus', value: 100 },
    { id: 'bus-a', source: 'point', target: 'a', mode: 'bus', value: 100 },
  ];
  const ports = portLayout(example);
  assert.deepEqual(['a', 'b', 'c'].map(id => {
    const p = ports.get(id); return [p.start, p.start + p.thickness];
  }), [[0, 120], [120, 300], [300, 600]]);
  assert.equal(ports.get('in-car').end, 0);
  assert.equal(ports.get('in-car').thickness, 600);
  assert.equal(ports.get('in-bus').end, 600);
  assert.equal(ports.get('bus-a').start, 600);
  const actual = portLayout(flows);
  for (const node of nodes) {
    for (const mode of modes) {
      const extent = (side, field) => {
        const p = flows.filter(f => f[side] === node.id && f.mode === mode.id).map(f => actual.get(f.id));
        return [Math.min(...p.map(v => v[field])), Math.max(...p.map(v => v[field] + v.thickness))];
      };
      const [inBottom, inTop] = extent('target', 'end'), [outBottom, outTop] = extent('source', 'start');
      assert.ok(Math.abs(inBottom - outBottom) < 1e-8);
      assert.ok(Math.abs(inTop - outTop) < 1e-8);
    }
  }
});

test('both bearing modes preserve ordered colors and compact bundles between node necks', () => {
  const points = new Map(nodes.map(n => [n.id, { x: (n.coords[0] - 18.667) * 71000, y: -(n.coords[1] - 50.302) * 111000 }]));
  for (const bearingMode of ['shared', 'snapped']) {
  const meshes = buildBatches(flows, points, bearingMode);
  const ranges = new Map(meshes.flatMap(mesh => mesh.userData.ranges.map(range => [range.flow.id, { ...range, mesh }])));
  for (const bundle of Map.groupBy(flows, f => `${f.source}/${f.target}`).values()) {
    const sorted = modes.flatMap(m => bundle.filter(f => f.mode === m.id));
    for (let i = 1; i < sorted.length; i++) {
      const a = ranges.get(sorted[i - 1].id), b = ranges.get(sorted[i].id);
      const p = a.mesh.geometry.getAttribute('position'), q = b.mesh.geometry.getAttribute('position');
      for (let step = 0; step < a.ribbonVertexCount / 6; step++) {
        // Every tessellated quad: top left/right touches the next band's bottom.
        for (const [top, bottom] of [[2, 0], [5, 1]]) {
          const v = a.start + step * 6 + top, w = b.start + step * 6 + bottom;
          assert.ok(Math.hypot(p.getX(v) - q.getX(w), p.getY(v) - q.getY(w)) < 0.0001);
          assert.ok(p.getZ(v) <= q.getZ(w) + 0.0001);
          const t = (step + (top === 5 ? 1 : 0)) / (a.ribbonVertexCount / 6);
          const progress = (t - NODE_NECK_FRACTION) / (1 - 2 * NODE_NECK_FRACTION);
          if (progress >= 0.25 && progress <= 0.75) assert.ok(Math.abs(p.getZ(v) - q.getZ(w)) < 0.0001,
            `${sorted[i].source} → ${sorted[i].target}, ${sorted[i].mode}, step ${step}`);
        }
      }
    }
  }
  meshes.forEach(m => { m.geometry.dispose(); m.material.dispose(); });
  }
});

test('shared mode fits one axis to all neighbours and keeps opposite neighbours stable', () => {
  const points = new Map([['center', { x: 0, y: 0 }], ['left', { x: -100, y: 0 }], ['right', { x: 100, y: 0 }]]);
  const sample = [
    { id: 'in', source: 'left', target: 'center', value: 235, mode: 'bicycle' },
    { id: 'out', source: 'center', target: 'right', value: 235, mode: 'bicycle' },
  ];
  const axis = nodeDirections(sample, points).get('center');
  assert.ok(Math.abs(axis.x - 1) < 1e-10);
  assert.ok(Math.abs(axis.y) < 1e-10);
  const directions = connectionDirections(sample, points, 'shared');
  assert.deepEqual(directions.get('out').source, axis);
  assert.ok(Math.abs(directions.get('in').target.x + axis.x) < 1e-10);
});

test('adaptive target-facing bearings are distinct at every node and shared by each transport bundle', () => {
  const points = new Map(nodes.map(n => [n.id, { x: (n.coords[0] - 18.667) * 71000, y: -(n.coords[1] - 50.302) * 111000 }]));
  const directions = connectionDirections(flows, points, 'snapped');
  for (const f of flows) {
    const a = points.get(f.source), b = points.get(f.target), length = Math.hypot(b.x - a.x, b.y - a.y);
    const d = directions.get(f.id);
    for (const axis of [d.source, d.target]) {
      assert.equal(axis.stepDegrees, 45);
      const angle = Math.atan2(axis.y, axis.x) / (axis.stepDegrees * Math.PI / 180);
      assert.ok(Math.abs(angle - Math.round(angle)) < 1e-10);
      assert.ok(Math.abs(Math.hypot(axis.x, axis.y) - 1) < 1e-10);
    }

  }
  for (const node of nodes) {
    const ports = new Map();
    for (const f of flows.filter(f => f.source === node.id || f.target === node.id)) {
      const key = `${f.source}/${f.target}`;
      const axis = directions.get(f.id)[f.source === node.id ? 'source' : 'target'];
      if (ports.has(key)) assert.equal(ports.get(key), axis);
      else ports.set(key, axis);
    }
    assert.equal(new Set([...ports.values()].map(p => p.slot)).size, ports.size, node.id);
    if (node.id === 'trynek') assert.equal(ports.size, 3);
  }
  assert.deepEqual(snapDirection(1, 0), { x: 1, y: 0 });
  assert.throws(() => connectionDirections(flows, points, 'unknown'));
  const shared = buildBatches(flows, points, 'shared');
  const snapped = buildBatches(flows, points, 'snapped');
  assert.notDeepEqual(shared[0].geometry.getAttribute('position').array, snapped[0].geometry.getAttribute('position').array);
  [...shared, ...snapped].forEach(m => { m.geometry.dispose(); m.material.dispose(); });
});

test('every shared node, including Rynek and Trynek, has whole incoming and outgoing stacks', () => {
  const points = new Map(nodes.map(n => [n.id, { x: (n.coords[0] - 18.667) * 71000, y: -(n.coords[1] - 50.302) * 111000 }]));
  const axes = nodeDirections(flows, points), ports = portLayout(flows);
  const directions = connectionDirections(flows, points, 'shared');
  for (const node of nodes) for (const side of ['source', 'target']) {
    const axis = axes.get(node.id), origin = points.get(node.id), outgoing = side === 'source';
    const connected = flows.filter(f => f[side] === node.id);
    for (const neckFraction of [0, 0.5, 1]) {
      const t = outgoing ? neckFraction * NODE_NECK_FRACTION : 1 - neckFraction * NODE_NECK_FRACTION;
      const expectedX = origin.x + axis.x * NODE_NECK_LENGTH * neckFraction * (outgoing ? 1 : -1);
      const expectedY = origin.y + axis.y * NODE_NECK_LENGTH * neckFraction * (outgoing ? 1 : -1);
      const intervals = connected.map(f => {
        const port = ports.get(f.id), point = ribbonCurve(f, points, directions, port)(t);
        assert.ok(Math.abs(point[0] - expectedX) < 1e-8);
        assert.ok(Math.abs(point[1] - expectedY) < 1e-8);
        assert.equal(point[2], outgoing ? port.start : port.end);
        return [point[2], point[2] + port.thickness];
      }).sort((a, b) => a[0] - b[0]);
      assert.equal(intervals[0][0], 0);
      for (let i = 1; i < intervals.length; i++) assert.ok(Math.abs(intervals[i][0] - intervals[i - 1][1]) < 1e-8);
      const volume = modes.reduce((sum, m) => sum + summarize(flows, node.id)[m.id][outgoing ? 'outgoing' : 'incoming'], 0);
      assert.ok(Math.abs(intervals.at(-1)[1] - volume * HEIGHT_SCALE) < 1e-8);
    }
  }
});

test('building clearance raises the full network and never falls while panning', () => {
  assert.equal(ribbonElevation([]), MIN_RIBBON_ELEVATION);
  assert.equal(ribbonElevation([110, 30]), 110 + BUILDING_CLEARANCE);
  assert.equal(ribbonElevation([15], 130), 130);
  assert.equal(ribbonElevation(['150', NaN, -10, Infinity]), 150 + BUILDING_CLEARANCE);
  const points = new Map(nodes.map((n, i) => [n.id, { x: i * 100, y: i * 200 }]));
  const guides = buildNodeGuides(flows, points);
  const p = guides.geometry.getAttribute('position');
  elevateNodeGuides(guides, 80);
  guides.userData.stackHeights.forEach((height, i) => {
    assert.equal(p.getZ(i * 2), 0);
    assert.ok(Math.abs(p.getZ(i * 2 + 1) - height - 80 - MAST_HEADROOM) < 0.0001);
  });
  elevateNodeGuides(guides, 150);
  guides.userData.stackHeights.forEach((height, i) => {
    assert.ok(Math.abs(p.getZ(i * 2 + 1) - height - 150 - MAST_HEADROOM) < 0.0001);
    assert.ok(Math.abs(mastTipHeight(guides, nodes[i].id, 150) - p.getZ(i * 2 + 1)) < 0.0001);
  });
  guides.geometry.dispose(); guides.material.dispose();
});
