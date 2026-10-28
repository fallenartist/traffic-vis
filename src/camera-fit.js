import * as THREE from 'three';

// Include every rendered vertex: projected triangle extrema lie at vertices.
// Deduplication keeps shared ribbon edges from adding repeated fit work.
export function geometryFitPoints(objects) {
  const result = [], seen = new Set(), point = new THREE.Vector3();
  for (const object of objects) {
    object.updateWorldMatrix(true, false);
    const positions = object.geometry.getAttribute('position');
    for (let i = 0; i < positions.count; i++) {
      point.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
      const key = `${point.x}/${point.y}/${point.z}`;
      if (seen.has(key)) continue;
      seen.add(key);
      result.push({ x: point.x, y: point.y, z: point.z });
    }
  }
  return result;
}

// Find the closest camera at a fixed orientation that encloses the actual 3D
// points and their optional screen-space label rectangles. Camera coordinates
// use Mapbox's east/south/up Mercator frame (screen-up starts at negative Y).
export function fitPerspectivePoints(points, { width, height, focalLength, orientation, padding = 36 }) {
  if (!points.length || width <= 0 || height <= 0 || !Number.isFinite(focalLength) || focalLength <= 0) {
    throw new Error('Camera fit requires points and a valid viewport/focal length.');
  }
  const inset = typeof padding === 'number' ? { left: padding, right: padding, top: padding, bottom: padding } : padding;
  const q = new THREE.Quaternion().fromArray(orientation);
  const right = new THREE.Vector3(1, 0, 0).applyQuaternion(q);
  const up = new THREE.Vector3(0, -1, 0).applyQuaternion(q);
  const forward = new THREE.Vector3(0, 0, -1).applyQuaternion(q);
  const bounds = new THREE.Box3();
  for (const p of points) bounds.expandByPoint(new THREE.Vector3(p.x, p.y, p.z));
  const center = bounds.getCenter(new THREE.Vector3());
  const projected = points.map(p => {
    const relative = new THREE.Vector3(p.x, p.y, p.z).sub(center);
    const tangents = {
      left: (width / 2 - (inset.left || 0) - (p.left || 0)) / focalLength,
      right: (width / 2 - (inset.right || 0) - (p.right || 0)) / focalLength,
      top: (height / 2 - (inset.top || 0) - (p.top || 0)) / focalLength,
      bottom: (height / 2 - (inset.bottom || 0) - (p.bottom || 0)) / focalLength,
    };
    if (Object.values(tangents).some(t => !Number.isFinite(t) || t <= 0)) {
      throw new Error('Viewport is too small for the requested labels and margins.');
    }
    return { x: relative.dot(right), y: relative.dot(up), depth: relative.dot(forward), ...tangents };
  });
  const intervals = distance => {
    let left = -Infinity, right = Infinity, bottom = -Infinity, top = Infinity;
    for (const p of projected) {
      const depth = p.depth + distance;
      if (depth <= 1) return null;
      left = Math.max(left, p.x - p.right * depth);
      right = Math.min(right, p.x + p.left * depth);
      bottom = Math.max(bottom, p.y - p.top * depth);
      top = Math.min(top, p.y + p.bottom * depth);
      if (left > right || bottom > top) return null;
    }
    return { x: (left + right) / 2, y: (bottom + top) / 2 };
  };
  let low = 0, high = Math.max(1, bounds.min.distanceTo(bounds.max));
  while (!intervals(high)) {
    high *= 2;
    if (high > 1e12) throw new Error('Unable to frame geometry.');
  }
  for (let i = 0; i < 48; i++) {
    const middle = (low + high) / 2;
    if (intervals(middle)) high = middle; else low = middle;
  }
  const distance = high * 1.005; // small safety margin for projection round-off
  const offset = intervals(distance);
  const position = center.clone().addScaledVector(right, offset.x)
    .addScaledVector(up, offset.y).addScaledVector(forward, -distance);
  return { position, distance };
}
