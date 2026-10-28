import * as THREE from 'three';
import { allocate, modes } from './data.js';

export const POINTS_PER_MOVEMENT = 16;
export const MAX_TRAJECTORY_POINTS = 250000;
export const TRAJECTORY_POINT_SIZE = 2.4;
export const TRAJECTORY_OPACITY = 0.28;
const SPREAD = 16;
const LANE_SPACING = 14;

function randomFor(id) {
  let seed = 2166136261;
  for (const char of id) seed = Math.imul(seed ^ char.charCodeAt(0), 16777619);
  return () => {
    seed += 0x6D2B79F5;
    let n = seed;
    n = Math.imul(n ^ n >>> 15, n | 1);
    n ^= n + Math.imul(n ^ n >>> 7, n | 61);
    return ((n ^ n >>> 14) >>> 0) / 4294967296;
  };
}

// This is a schematic straight OD connection, not a measured GPS trajectory.
// Small mode offsets separate colors; all streams meet at the actual endpoints.
export function trajectoryCenter(flow, points, t) {
  const a = points.get(flow.source), b = points.get(flow.target);
  const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
  const modeIndex = modes.findIndex(m => m.id === flow.mode);
  const lane = (modeIndex - (modes.length - 1) / 2) * LANE_SPACING * Math.sin(Math.PI * t);
  return [a.x + dx * t - dy / length * lane, a.y + dy * t + dx / length * lane, 2];
}

function pointSprite() {
  const size = 32, pixels = new Uint8Array(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const radius = Math.hypot((x + 0.5) / size - 0.5, (y + 0.5) / size - 0.5) * 2;
    const falloff = Math.max(0, Math.min(1, (1 - radius) / 0.4));
    const offset = (y * size + x) * 4;
    pixels.set([255, 255, 255, Math.round(255 * falloff * falloff * (3 - 2 * falloff))], offset);
  }
  const texture = new THREE.DataTexture(pixels, size, size);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

export function buildTrajectoryBatches(flows, points, maxPoints = MAX_TRAJECTORY_POINTS) {
  if (!Number.isSafeInteger(maxPoints) || maxPoints < 1) throw new Error('Point budget must be a positive integer.');
  const total = flows.reduce((sum, f) => sum + f.value, 0);
  const budget = Math.min(maxPoints, total * POINTS_PER_MOVEMENT);
  const counts = allocate(budget, flows.map(f => f.value));
  const countById = new Map(flows.map((f, i) => [f.id, counts[i]]));
  const sprite = pointSprite();
  return modes.map(mode => {
    const matching = flows.filter(f => f.mode === mode.id);
    const count = matching.reduce((sum, f) => sum + countById.get(f.id), 0);
    const positions = new Float32Array(count * 3);
    const colors = new Float32Array(count * 4);
    const ranges = [];
    let cursor = 0;
    for (const flow of matching) {
      const random = randomFor(flow.id), n = countById.get(flow.id);
      const a = points.get(flow.source), b = points.get(flow.target);
      const dx = b.x - a.x, dy = b.y - a.y, length = Math.hypot(dx, dy);
      for (let i = 0; i < n; i++) {
        const t = (i + random()) / n;
        const p = trajectoryCenter(flow, points, t);
        const gaussian = Math.max(-3, Math.min(3,
          Math.sqrt(-2 * Math.log(Math.max(1e-9, random()))) * Math.cos(2 * Math.PI * random())));
        const jitter = gaussian * SPREAD * Math.sin(Math.PI * t);
        positions.set([p[0] - dy / length * jitter, p[1] + dx / length * jitter, p[2]], (cursor + i) * 3);
      }
      ranges.push({ flow, start: cursor, count: n });
      cursor += n;
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(colors, 4));
    const material = new THREE.PointsMaterial({
      map: sprite, vertexColors: true, size: TRAJECTORY_POINT_SIZE,
      sizeAttenuation: false, transparent: true, depthWrite: false, depthTest: false,
    });
    const cloud = new THREE.Points(geometry, material);
    cloud.frustumCulled = false;
    cloud.userData = { mode, ranges, activeOpacity: TRAJECTORY_OPACITY, pointCount: count };
    return cloud;
  });
}
