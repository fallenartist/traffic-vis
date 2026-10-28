import * as THREE from 'three';
import { modes } from './data.js';
import { allocateBearingSlots } from './bearings.js';

export const HEIGHT_SCALE = 0.6; // twice the previous vertical scale of 0.3 metres/count
export const MAST_HEADROOM = 35;
export const NODE_NECK_LENGTH = 55;
export const NODE_NECK_FRACTION = 0.125;
export const DEFAULT_BEARING_MODE = 'snapped';
const STEPS = 48;

// A node has ONE contiguous band for each transport mode, shared by arrivals
// and departures. Directions partition that band's capacity, rather than
// repeating the color stack at different heights for every destination.
export function portLayout(flows) {
  const bands = new Map();
  const ids = new Set(flows.flatMap(f => [f.source, f.target]));
  for (const id of ids) {
    let bottom = 0;
    for (const mode of modes) {
      const group = flows.filter(f => f.mode === mode.id);
      const incoming = group.filter(f => f.target === id).reduce((s, f) => s + f.value, 0);
      const outgoing = group.filter(f => f.source === id).reduce((s, f) => s + f.value, 0);
      const capacity = Math.max(incoming, outgoing) * HEIGHT_SCALE;
      bands.set(`${id}/${mode.id}`, bottom);
      bottom += capacity;
    }
  }
  const incoming = new Map(), outgoing = new Map();
  const layout = new Map();
  for (const mode of modes) for (const f of flows.filter(f => f.mode === mode.id)) {
    const sourceKey = `${f.source}/${mode.id}`, targetKey = `${f.target}/${mode.id}`;
    const start = bands.get(sourceKey) + (outgoing.get(sourceKey) || 0);
    const end = bands.get(targetKey) + (incoming.get(targetKey) || 0);
    const thickness = f.value * HEIGHT_SCALE;
    layout.set(f.id, { start, end, thickness });
    outgoing.set(sourceKey, (outgoing.get(sourceKey) || 0) + thickness);
    incoming.set(targetKey, (incoming.get(targetKey) || 0) + thickness);
  }
  // Between the nodes, directions regroup into compact bundles. Their center
  // follows the weighted center of the endpoint partitions, preserving order.
  for (const bundle of Map.groupBy(flows, f => `${f.source}/${f.target}`).values()) {
    const total = bundle.reduce((sum, f) => sum + layout.get(f.id).thickness, 0);
    const center = side => bundle.reduce((sum, f) => {
      const port = layout.get(f.id);
      return sum + (port[side] + port.thickness / 2) * port.thickness;
    }, 0) / total;
    const bundleStart = center('start') - total / 2;
    const bundleEnd = center('end') - total / 2;
    let offset = 0;
    for (const mode of modes) for (const f of bundle.filter(f => f.mode === mode.id)) {
      Object.assign(layout.get(f.id), { bundleStart, bundleEnd, bundleOffset: offset });
      offset += layout.get(f.id).thickness;
    }
  }
  return layout;
}

// Least-squares axis through ALL connected neighbours, not only outgoing
// destinations. The principal axis avoids cancellation for opposite neighbours.
// Orient it along the net travel direction; arrivals use the opposite side.
export function nodeDirections(flows, points) {
  const result = new Map();
  for (const [id, a] of points) {
    let xx = 0, xy = 0, yy = 0, travelX = 0, travelY = 0;
    let strongest = null;
    for (const f of flows) {
      if (f.source !== id && f.target !== id) continue;
      const outgoing = f.source === id;
      const b = points.get(outgoing ? f.target : f.source);
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      if (!length) continue;
      const dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
      xx += f.value * dx * dx; xy += f.value * dx * dy; yy += f.value * dy * dy;
      travelX += f.value * dx * (outgoing ? 1 : -1);
      travelY += f.value * dy * (outgoing ? 1 : -1);
      if (outgoing && (!strongest || f.value > strongest.weight)) strongest = { x: dx, y: dy, weight: f.value };
    }
    const angle = Math.atan2(2 * xy, xx - yy) / 2;
    let x = Math.cos(angle), y = Math.sin(angle);
    let dot = travelX * x + travelY * y;
    if (Math.abs(dot) < 1e-8 && strongest) dot = strongest.x * x + strongest.y * y;
    if (dot < 0) { x = -x; y = -y; }
    result.set(id, { x, y });
  }
  return result;
}

export function snapDirection(dx, dy) {
  const step = Math.PI / 4;
  const angle = Math.round(Math.atan2(dy, dx) / step) * step;
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

export function connectionDirections(flows, points, bearingMode = DEFAULT_BEARING_MODE) {
  if (!['shared', 'snapped'].includes(bearingMode)) throw new Error(`Unknown bearing mode: ${bearingMode}`);
  if (bearingMode === 'snapped') {
    // Reserve one distinct port for every directed connection, including
    // arrivals and departures together. Transport types of the same OD pair
    // stay stacked and share their assigned angle.
    const connections = new Map(flows.map(f => [`${f.source}/${f.target}`, f]));
    const ports = new Map();
    for (const [id, a] of points) {
      const incident = [];
      for (const [key, f] of connections) {
        if (f.source !== id && f.target !== id) continue;
        const b = points.get(f.source === id ? f.target : f.source);
        incident.push({ key, dx: b.x - a.x, dy: b.y - a.y });
      }
      ports.set(id, allocateBearingSlots(incident));
    }
    return new Map(flows.map(f => {
      const key = `${f.source}/${f.target}`;
      return [f.id, { source: ports.get(f.source).get(key), target: ports.get(f.target).get(key) }];
    }));
  }
  const axes = nodeDirections(flows, points);
  return new Map(flows.map(f => {
    const source = axes.get(f.source);
    const targetAxis = axes.get(f.target);
    const target = { x: -targetAxis.x, y: -targetAxis.y };
    return [f.id, { source, target }];
  }));
}

export function ribbonCurve(flow, points, directions, port) {
  const a = points.get(flow.source), b = points.get(flow.target);
  const { source, target } = directions.get(flow.id);
  const distance = Math.hypot(b.x - a.x, b.y - a.y);
  // Both ends have a short flat neck. In shared mode this collects every
  // incoming color into its full node band before it reaches the mast, and
  // every outgoing color stays whole until the common exit begins branching.
  const neck = Math.min(NODE_NECK_LENGTH, distance * 0.15);
  const start = { x: a.x + source.x * neck, y: a.y + source.y * neck };
  const end = { x: b.x + target.x * neck, y: b.y + target.y * neck };
  const c1 = { x: start.x + source.x * distance * 0.5, y: start.y + source.y * distance * 0.5 };
  const c2 = { x: end.x + target.x * distance * 0.5, y: end.y + target.y * distance * 0.5 };
  return t => {
    if (t <= NODE_NECK_FRACTION) {
      const progress = t / NODE_NECK_FRACTION;
      return [a.x + source.x * neck * progress, a.y + source.y * neck * progress, port.start];
    }
    if (t >= 1 - NODE_NECK_FRACTION) {
      const progress = (1 - t) / NODE_NECK_FRACTION;
      return [b.x + target.x * neck * progress, b.y + target.y * neck * progress, port.end];
    }
    const progressT = (t - NODE_NECK_FRACTION) / (1 - 2 * NODE_NECK_FRACTION);
    const u = 1 - progressT;
    const smooth = x => x * x * (3 - 2 * x);
    const progress = smooth(progressT);
    const fan = smooth(Math.min(1, progressT * 4)) * smooth(Math.min(1, (1 - progressT) * 4));
    const nodeHeight = port.start * (1 - progress) + port.end * progress;
    const bundleHeight = port.bundleStart * (1 - progress) + port.bundleEnd * progress + port.bundleOffset;
    return [u ** 3 * start.x + 3 * u * u * progressT * c1.x + 3 * u * progressT * progressT * c2.x + progressT ** 3 * end.x,
      u ** 3 * start.y + 3 * u * u * progressT * c1.y + 3 * u * progressT * progressT * c2.y + progressT ** 3 * end.y,
      nodeHeight * (1 - fan) + bundleHeight * fan];
  };
}

export function buildBatches(flows, points, bearingMode = DEFAULT_BEARING_MODE) {
  const ports = portLayout(flows);
  const directions = connectionDirections(flows, points, bearingMode);
  return modes.map(mode => {
    const positions = [], faces = [], ranges = [];
    const pushTriangle = (a, b, c, flow) => {
      positions.push(...a, ...b, ...c);
      faces.push(flow);
    };
    for (const flow of flows.filter(f => f.mode === mode.id)) {
      const startVertex = positions.length / 3;
      const port = ports.get(flow.id);
      const curve = ribbonCurve(flow, points, directions, port);
      const edges = t => {
        const p = curve(t);
        return [p, [p[0], p[1], p[2] + port.thickness]];
      };
      for (let i = 0; i < STEPS; i++) {
        const [a0, a1] = edges(i / STEPS), [b0, b1] = edges((i + 1) / STEPS);
        pushTriangle(a0, b0, a1, flow);
        pushTriangle(a1, b0, b1, flow);
      }
      const ribbonVertexCount = positions.length / 3 - startVertex;
      ranges.push({ flow, start: startVertex, count: positions.length / 3 - startVertex, ribbonVertexCount });
    }
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(new Float32Array(positions.length / 3 * 4), 4));
    const material = new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide,
      transparent: true, opacity: 1, depthWrite: false });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.frustumCulled = false;
    mesh.userData = { mode, ranges, faces, activeOpacity: 0.87 };
    return mesh;
  });
}

export function buildNodeGuides(flows, points) {
  const ports = portLayout(flows), vertices = [];
  for (const [id, point] of points) {
    let height = 0;
    for (const f of flows) {
      const port = ports.get(f.id);
      if (f.source === id) height = Math.max(height, port.start + port.thickness);
      if (f.target === id) height = Math.max(height, port.end + port.thickness);
    }
    vertices.push(point.x, point.y, 0, point.x, point.y, height);
  }
  const guides = new THREE.LineSegments(new THREE.BufferGeometry().setAttribute('position',
    new THREE.Float32BufferAttribute(vertices, 3)),
  new THREE.LineBasicMaterial({ color: 0xe9f0f5, transparent: true, opacity: 0.7, depthWrite: false }));
  guides.userData.stackHeights = vertices.filter((_, i) => i % 6 === 5);
  guides.userData.nodeIndices = new Map([...points.keys()].map((id, index) => [id, index]));
  return guides;
}

export function elevateNodeGuides(guides, elevation) {
  const positions = guides.geometry.getAttribute('position');
  guides.userData.stackHeights.forEach((height, i) => positions.setZ(i * 2 + 1, height + elevation + MAST_HEADROOM));
  positions.needsUpdate = true;
  guides.geometry.computeBoundingSphere();
}

export function mastTipHeight(guides, nodeId, elevation) {
  const index = guides.userData.nodeIndices.get(nodeId);
  return guides.userData.stackHeights[index] + elevation + MAST_HEADROOM;
}

export function recolor(meshes, selectedMode, nodeId) {
  for (const mesh of meshes) {
    const { mode, ranges } = mesh.userData;
    mesh.visible = true;
    const attribute = mesh.geometry.getAttribute('color');
    const base = new THREE.Color(mode.color);
    for (const { flow, start, count } of ranges) {
      const connected = (!selectedMode || mode.id === selectedMode) &&
        (!nodeId || flow.source === nodeId || flow.target === nodeId);
      const alpha = mesh.userData.activeOpacity * (connected ? 1 : 0.12);
      for (let v = start; v < start + count; v++) attribute.setXYZW(v, base.r, base.g, base.b, alpha);
    }
    attribute.needsUpdate = true;
  }
}
