import test from 'node:test';
import assert from 'node:assert/strict';
import { flows, nodes, modes } from '../src/data.js';
import { recolor, buildBatches } from '../src/geometry.js';
import { buildTrajectoryBatches, trajectoryCenter, POINTS_PER_MOVEMENT, TRAJECTORY_OPACITY } from '../src/trajectories.js';

const points = new Map(nodes.map(n => [n.id, {
  x: (n.coords[0] - 18.667) * 71000, y: -(n.coords[1] - 50.302) * 111000,
}]));
function dispose(objects) {
  const textures = new Set(objects.map(o => o.material.map).filter(Boolean));
  objects.forEach(o => { o.geometry.dispose(); o.material.dispose(); });
  textures.forEach(t => t.dispose());
}

test('2D uses point clouds with density proportional to movement counts', () => {
  const clouds = buildTrajectoryBatches(flows, points);
  assert.equal(clouds.length, modes.length);
  assert.ok(clouds.every(c => c.isPoints && !c.isMesh));
  const expected = flows.reduce((sum, f) => sum + f.value, 0) * POINTS_PER_MOVEMENT;
  assert.equal(clouds.reduce((sum, c) => sum + c.userData.pointCount, 0), expected);
  for (const cloud of clouds) {
    assert.equal(cloud.geometry.getAttribute('position').count, cloud.userData.pointCount);
    assert.ok(cloud.geometry.getAttribute('position').array.every(Number.isFinite));
    assert.equal(cloud.geometry.getAttribute('color').itemSize, 4);
    for (const r of cloud.userData.ranges) assert.equal(r.count, r.flow.value * POINTS_PER_MOVEMENT);
    assert.ok(cloud.geometry.getAttribute('position').array.filter((_, i) => i % 3 === 2).every(z => z === 2));
  }
  assert.equal(new Set(clouds.map(c => c.material.map)).size, 1);
  dispose(clouds);
});

test('large datasets share one bounded point budget without changing flow values', () => {
  const before = flows.map(f => f.value);
  const clouds = buildTrajectoryBatches(flows, points, 2000);
  assert.equal(clouds.reduce((sum, c) => sum + c.userData.pointCount, 0), 2000);
  const total = before.reduce((a, b) => a + b, 0);
  for (const cloud of clouds) for (const r of cloud.userData.ranges) {
    assert.ok(Math.abs(r.count - 2000 * r.flow.value / total) <= 1);
  }
  assert.deepEqual(flows.map(f => f.value), before);
  dispose(clouds);
});

test('points are deterministic and each schematic route meets its real endpoints', () => {
  const a = buildTrajectoryBatches(flows, points, 500), b = buildTrajectoryBatches(flows, points, 500);
  a.forEach((c, i) => assert.deepEqual(c.geometry.getAttribute('position').array, b[i].geometry.getAttribute('position').array));
  for (const f of flows) {
    for (const [t, id] of [[0, f.source], [1, f.target]]) {
      const p = trajectoryCenter(f, points, t), expected = points.get(id);
      assert.ok(Math.hypot(p[0] - expected.x, p[1] - expected.y) < 1e-8);
    }
  }
  dispose([...a, ...b]);
});

test('inactive ribbons and points retain their colors but use genuinely lower alpha', () => {
  const ribbons = buildBatches(flows, points), clouds = buildTrajectoryBatches(flows, points, 500);
  for (const objects of [ribbons, clouds]) {
    recolor(objects, null, null);
    const activeColor = objects[0].geometry.getAttribute('color');
    const rgb = [activeColor.getX(0), activeColor.getY(0), activeColor.getZ(0)];
    const activeAlpha = activeColor.getW(0);
    recolor(objects, 'bus', null);
    assert.equal(objects[0].visible, true);
    assert.deepEqual([activeColor.getX(0), activeColor.getY(0), activeColor.getZ(0)], rgb);
    assert.ok(activeColor.getW(0) < activeAlpha * 0.2);
    assert.ok(objects[1].geometry.getAttribute('color').getW(0) > activeAlpha * 0.9);
    recolor(objects, null, null);
    assert.ok(Math.abs(activeColor.getW(0) - activeAlpha) < 1e-6);
  }
  assert.ok(TRAJECTORY_OPACITY < 0.5);
  dispose([...ribbons, ...clouds]);
});
