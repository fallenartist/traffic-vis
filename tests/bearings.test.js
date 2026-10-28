import test from 'node:test';
import assert from 'node:assert/strict';
import { allocateBearingSlots, angleStepForConnections } from '../src/bearings.js';
import { connectionDirections, DEFAULT_BEARING_MODE } from '../src/geometry.js';

function vector(key, degrees) {
  const angle = degrees * Math.PI / 180;
  return { key, dx: Math.cos(angle), dy: Math.sin(angle) };
}

test('adaptive mode is default and reserves unique slots even for identical target bearings', () => {
  assert.equal(DEFAULT_BEARING_MODE, 'snapped');
  const connections = [vector('a', 0), vector('b', 0), vector('c', 0)];
  const result = allocateBearingSlots(connections);
  assert.equal(new Set([...result.values()].map(p => p.slot)).size, 3);
  assert.ok([...result.values()].every(p => p.stepDegrees === 45));
  const points = new Map([['center', { x: 0, y: 0 }], ['a', { x: 100, y: 0 }], ['b', { x: 200, y: 0 }]]);
  const flows = [
    { id: 'one', source: 'center', target: 'a', value: 10, mode: 'car' },
    { id: 'two', source: 'center', target: 'b', value: 10, mode: 'car' },
  ];
  const directions = connectionDirections(flows, points);
  assert.notEqual(directions.get('one').source.slot, directions.get('two').source.slot);
});

test('slot spacing falls to 30 and 15 degrees as connections outgrow the available grid', () => {
  for (const [count, expectedStep] of [[8, 45], [9, 30], [12, 30], [13, 15], [24, 15], [25, 7.5], [49, 3.75]]) {
    const connections = Array.from({ length: count }, (_, i) => vector(`route-${i}`, 0));
    const assigned = allocateBearingSlots(connections);
    assert.equal(angleStepForConnections(count), expectedStep);
    assert.equal(new Set([...assigned.values()].map(p => p.slot)).size, count);
    for (const axis of assigned.values()) {
      assert.equal(axis.stepDegrees, expectedStep);
      const index = Math.atan2(axis.y, axis.x) / (expectedStep * Math.PI / 180);
      assert.ok(Math.abs(index - Math.round(index)) < 1e-10);
    }
  }
});

test('opposite directions and transport types count as the correct number of distinct ports', () => {
  const points = new Map([['center', { x: 0, y: 0 }]]), flows = [];
  for (let i = 0; i < 5; i++) {
    const id = `point-${i}`;
    points.set(id, { x: 100 + i, y: i });
    for (const mode of ['car', 'bus', 'bicycle', 'pedestrian']) {
      flows.push({ id: `out-${i}-${mode}`, source: 'center', target: id, mode, value: 10 });
      flows.push({ id: `in-${i}-${mode}`, source: id, target: 'center', mode, value: 10 });
    }
  }
  const assigned = connectionDirections(flows, points);
  const slots = new Set();
  for (const f of flows) {
    const axis = assigned.get(f.id)[f.source === 'center' ? 'source' : 'target'];
    assert.equal(axis.stepDegrees, 30); // 5 outgoing + 5 incoming, not 5 neighbours or 40 modes
    slots.add(axis.slot);
  }
  assert.equal(slots.size, 10);
});

test('assignment is stable across input order and minimizes total circular angular error', () => {
  const connections = [vector('a', 359), vector('b', 0), vector('c', 1)];
  const assigned = allocateBearingSlots(connections);
  const reversed = allocateBearingSlots([...connections].reverse());
  for (const c of connections) assert.deepEqual(assigned.get(c.key), reversed.get(c.key));
  const error = (c, slot) => {
    const delta = Math.atan2(c.dy, c.dx) - slot * Math.PI / 4;
    return Math.atan2(Math.sin(delta), Math.cos(delta)) ** 2;
  };
  const actual = connections.reduce((sum, c) => sum + error(c, assigned.get(c.key).slot), 0);
  let optimum = Infinity;
  for (let a = 0; a < 8; a++) for (let b = 0; b < 8; b++) for (let c = 0; c < 8; c++) {
    if (new Set([a, b, c]).size !== 3) continue;
    optimum = Math.min(optimum, error(connections[0], a) + error(connections[1], b) + error(connections[2], c));
  }
  assert.ok(Math.abs(actual - optimum) < 1e-10);
  assert.throws(() => allocateBearingSlots([vector('same', 0), vector('same', 45)]));
});
