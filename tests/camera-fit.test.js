import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import mapboxgl from 'mapbox-gl';
import { geometryFitPoints, fitPerspectivePoints } from '../src/camera-fit.js';
import { nodes, flows } from '../src/data.js';
import { buildBatches, buildNodeGuides, elevateNodeGuides, mastTipHeight } from '../src/geometry.js';

const orientation = new mapboxgl.FreeCameraOptions();
orientation.setPitchBearing(45, 0);

function screenBounds(points, fit, width, height, focalLength) {
  // Independently project through Three's camera matrices. Mapbox uses south
  // for positive world Y, so its camera has a reflected screen-up axis.
  const camera = new THREE.PerspectiveCamera(2 * Math.atan(height / (2 * focalLength)) * 180 / Math.PI,
    width / height, 0.1, 1e8);
  camera.position.copy(fit.position);
  camera.quaternion.fromArray(orientation.orientation);
  camera.scale.y = -1;
  camera.updateMatrixWorld();
  const bounds = { left: Infinity, right: -Infinity, top: Infinity, bottom: -Infinity };
  for (const p of points) {
    const v = new THREE.Vector3(p.x, p.y, p.z).project(camera);
    assert.ok(v.z >= -1 && v.z <= 1, 'point must be in front of camera');
    const x = (v.x + 1) * width / 2, y = (1 - v.y) * height / 2;
    bounds.left = Math.min(bounds.left, x - (p.left || 0));
    bounds.right = Math.max(bounds.right, x + (p.right || 0));
    bounds.top = Math.min(bounds.top, y - (p.top || 0));
    bounds.bottom = Math.max(bounds.bottom, y + (p.bottom || 0));
  }
  return bounds;
}

const origin = mapboxgl.MercatorCoordinate.fromLngLat([18.667, 50.302]);
const units = origin.meterInMercatorCoordinateUnits();
const positions = new Map(nodes.map(n => {
  const p = mapboxgl.MercatorCoordinate.fromLngLat(n.coords);
  return [n.id, { x: (p.x - origin.x) / units, y: (p.y - origin.y) / units }];
}));

for (const [width, height] of [[1100, 800], [400, 700]]) {
  test(`full elevated diagram and mast labels fit tightly in ${width}×${height}`, () => {
    const elevation = 200;
    const batches = buildBatches(flows, positions, 'snapped');
    batches.forEach(mesh => { mesh.position.z = elevation; });
    const guides = buildNodeGuides(flows, positions);
    elevateNodeGuides(guides, elevation);
    const points = geometryFitPoints([...batches, guides]);
    for (const node of nodes) points.push({ ...positions.get(node.id),
      z: mastTipHeight(guides, node.id, elevation), left: 80, right: 80, top: 28 });
    const focalLength = height * 1.5, padding = Math.min(36, Math.min(width, height) * 0.07);
    const fit = fitPerspectivePoints(points, { width, height, focalLength, padding,
      orientation: orientation.orientation });
    const bounds = screenBounds(points, fit, width, height, focalLength);
    assert.ok(bounds.left >= padding && bounds.right <= width - padding, JSON.stringify(bounds));
    assert.ok(bounds.top >= padding && bounds.bottom <= height - padding, JSON.stringify(bounds));
    const occupancy = Math.max((bounds.right - bounds.left) / (width - 2 * padding),
      (bounds.bottom - bounds.top) / (height - 2 * padding));
    assert.ok(occupancy > 0.98, `diagram should fill available viewport: ${occupancy}`);
    const oldMargins = fitPerspectivePoints(points, { width, height, focalLength,
      orientation: orientation.orientation, padding: { left: 65, right: 65, top: 200, bottom: 140 } });
    assert.ok(fit.distance < oldMargins.distance, 'tighter margins bring camera closer');
    [...batches, guides].forEach(object => { object.geometry.dispose(); object.material.dispose(); });
  });
}

test('fit samples include object transforms and omit repeated vertices', () => {
  const geometry = new THREE.BufferGeometry();
  geometry.setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 1, 2, 3], 3));
  const object = new THREE.Mesh(geometry);
  object.position.set(4, 5, 30);
  assert.deepEqual(geometryFitPoints([object]), [{ x: 4, y: 5, z: 30 }, { x: 5, y: 7, z: 33 }]);
  geometry.dispose();
  object.material.dispose();
});

test('fit rejects empty input and impossible viewport sizes', () => {
  const options = { width: 400, height: 700, focalLength: 1050, orientation: orientation.orientation };
  assert.throws(() => fitPerspectivePoints([], options));
  assert.throws(() => fitPerspectivePoints([{ x: 0, y: 0, z: 0 }], { ...options, width: 0 }));
  assert.throws(() => fitPerspectivePoints([{ x: 0, y: 0, z: 0, left: 300 }], options));
});
