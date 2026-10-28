import mapboxgl from 'mapbox-gl';
import { MAPBOX_TOKEN, MAPBOX_STYLE } from './map-config.js';
import * as THREE from 'three';
import { nodes, modes, flows, summarize, TRAFFIC_MULTIPLIER } from './data.js';
import { buildBatches, buildNodeGuides, elevateNodeGuides, mastTipHeight, recolor, HEIGHT_SCALE, DEFAULT_BEARING_MODE } from './geometry.js';
import { ribbonElevation, MIN_RIBBON_ELEVATION } from './elevation.js';
import { buildTrajectoryBatches, trajectoryCenter, TRAJECTORY_POINT_SIZE, POINTS_PER_MOVEMENT } from './trajectories.js';
import './style.css';

const $ = selector => document.querySelector(selector);
const format = new Intl.NumberFormat('pl-PL');
const plurals = new Intl.PluralRules('pl');
const nodeById = new Map(nodes.map(n => [n.id, n]));
const modeById = new Map(modes.map(m => [m.id, m]));
let view = '3d', selectedMode = null, selectedNode = null;
const bearingMode = DEFAULT_BEARING_MODE;
let batches = null, cameraReady = false, frameCount = 0;
const camera = new THREE.Camera();
const scene = new THREE.Scene();
const projection = new THREE.Matrix4();
const inverse = new THREE.Matrix4();
const raycaster = new THREE.Raycaster();
const origin = mapboxgl.MercatorCoordinate.fromLngLat([18.667, 50.302]);
const units = origin.meterInMercatorCoordinateUnits();
const transform = new THREE.Matrix4().makeTranslation(origin.x, origin.y, 0)
  .scale(new THREE.Vector3(units, units, units));
const points = new Map(nodes.map(n => {
  const c = mapboxgl.MercatorCoordinate.fromLngLat(n.coords);
  return [n.id, { x: (c.x - origin.x) / units, y: (c.y - origin.y) / units }];
}));
// The local scene uses Mercator metres at the origin; Marker altitude uses
// real metres at each node. Match them so labels project exactly at mast tips.
const markerAltitudeRatios = new Map(nodes.map(n => [n.id,
  units / mapboxgl.MercatorCoordinate.fromLngLat(n.coords).meterInMercatorCoordinateUnits()]));
// Geometry is built once per view. Selection only changes colors/visibility.
const cache = new Map();
const nodeGuides = buildNodeGuides(flows, points);
let baseElevation = MIN_RIBBON_ELEVATION;
elevateNodeGuides(nodeGuides, baseElevation);
const markers = new Map();
let map;
try {
  if (!MAPBOX_TOKEN) throw new Error('Brak tokenu Mapbox w konfiguracji środowiska.');
  map = new mapboxgl.Map({
    container: 'map', center: [18.665, 50.302], zoom: 13.3, pitch: 45, bearing: 0,
    maxPitch: 70, renderWorldCopies: false, projection: { name: 'mercator' },
    antialias: true, accessToken: MAPBOX_TOKEN, style: MAPBOX_STYLE,
    locale: {
      'NavigationControl.ZoomIn': 'Przybliż',
      'NavigationControl.ZoomOut': 'Oddal',
      'NavigationControl.ResetBearing': 'Ustaw północ u góry',
      'AttributionControl.ToggleAttribution': 'Pokaż źródła mapy',
      'Map.Title': 'Mapa przepływów ruchu',
      'ScrollZoomBlocker.CtrlMessage': 'Przytrzymaj Ctrl i przewiń, aby przybliżyć mapę',
      'ScrollZoomBlocker.CmdMessage': 'Przytrzymaj ⌘ i przewiń, aby przybliżyć mapę',
      'TouchPanBlocker.Message': 'Przesuń mapę dwoma palcami',
      'LogoControl.Title': 'Otwórz stronę Mapbox',
    },
  });
} catch (error) {
  $('#status').classList.add('error');
  $('#status').textContent = `Mapa niedostępna: ${error.message}. Dane połączeń są nadal dostępne poniżej.`;
}

const trafficLayer = {
  id: 'traffic-ribbons', type: 'custom', renderingMode: '3d',
  onAdd(_map, gl) {
    this.renderer = new THREE.WebGLRenderer({ canvas: _map.getCanvas(), context: gl, antialias: true });
    this.renderer.autoClear = false;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    switchGeometry();
  },
  // Keep Mapbox's Mercator matrix and share its WebGL2 context.
  render(gl, matrix) {
    projection.fromArray(matrix).multiply(transform);
    camera.projectionMatrix.copy(projection);
    camera.projectionMatrixInverse.copy(projection).invert();
    inverse.copy(camera.projectionMatrixInverse);
    cameraReady = true;
    // Mapbox owns canvas sizing. Keep Three's viewport aligned without
    // resizing or replacing the shared context.
    this.renderer.resetState();
    this.renderer.setViewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
    if (view === '2d') {
      const pixelRatio = gl.drawingBufferWidth / Math.max(1, map.getContainer().clientWidth);
      batches.forEach(cloud => { cloud.material.size = TRAJECTORY_POINT_SIZE * pixelRatio; });
    }
    this.renderer.render(scene, camera);
    this.renderer.resetState();
    frameCount++;
    // No triggerRepaint here: an idle scene should consume no render frames.
  },
  onRemove() {
    const textures = new Set();
    for (const meshes of cache.values()) for (const mesh of meshes) {
      if (mesh.material.map) textures.add(mesh.material.map);
      mesh.geometry.dispose();
      mesh.material.dispose();
    }
    textures.forEach(texture => texture.dispose());
    cache.clear();
    nodeGuides.geometry.dispose();
    nodeGuides.material.dispose();
    this.renderer.dispose();
  },
};

function switchGeometry() {
  const key = view === '3d' ? `3d:${bearingMode}` : '2d';
  if (!cache.has(key)) cache.set(key, view === '3d'
    ? buildBatches(flows, points, bearingMode) : buildTrajectoryBatches(flows, points));
  scene.clear();
  batches = cache.get(key);
  if (view === '3d') batches.forEach(mesh => { mesh.position.z = baseElevation; });
  batches.forEach(mesh => scene.add(mesh));
  if (view === '3d') scene.add(nodeGuides);
  recolor(batches, selectedMode, selectedNode);
  map?.triggerRepaint();
}

function updateMarkerAltitudes() {
  for (const [id, marker] of markers) {
    marker.setAltitude(view === '3d'
      ? mastTipHeight(nodeGuides, id, baseElevation) * markerAltitudeRatios.get(id) : 0);
  }
}

function updateBuildingClearance() {
  if (view !== '3d' || !map?.isStyleLoaded()) return;
  const heights = [];
  const layers = (map.getStyle().layers || []).filter(layer =>
    layer.type === 'fill-extrusion' && layer.layout?.visibility !== 'none');
  for (const layer of layers) {
    const paintHeight = map.getPaintProperty(layer.id, 'fill-extrusion-height');
    if (typeof paintHeight === 'number') heights.push(paintHeight);
    // Source queries include loaded buildings hidden behind other geometry.
    // Mapbox building tiles express these heights in metres.
    const features = map.querySourceFeatures(layer.source, {
      ...(layer['source-layer'] ? { sourceLayer: layer['source-layer'] } : {}),
      ...(layer.filter ? { filter: layer.filter } : {}),
    });
    for (const feature of features) {
      for (const key of ['height', 'render_height', 'max_height', 'building:height']) {
        if (feature.properties?.[key] != null) heights.push(feature.properties[key]);
      }
    }
  }
  const next = ribbonElevation(heights, baseElevation);
  if (next === baseElevation) return;
  baseElevation = next;
  for (const [key, meshes] of cache) {
    if (key.startsWith('3d:')) meshes.forEach(mesh => { mesh.position.z = baseElevation; });
  }
  elevateNodeGuides(nodeGuides, baseElevation);
  updateMarkerAltitudes();
  $('#elevation-note').textContent = `Poziom wstęg: ${format.format(baseElevation)} m · co najmniej 20 m nad rozpoznanymi budynkami`;
  map.triggerRepaint();
}

function fitNetwork(animate = true) {
  if (!map) return;
  const bounds = new mapboxgl.LngLatBounds();
  nodes.forEach(n => bounds.extend(n.coords));
  map.fitBounds(bounds, { padding: { top: view === '3d' ? 200 : 65, bottom: view === '3d' ? 140 : 65, left: 65, right: 65 },
    pitch: view === '3d' ? 45 : 0, bearing: 0,
    duration: animate && !window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 650 : 0 });
}

if (map) {
  map.addControl(new mapboxgl.NavigationControl(), 'top-right');
  map.addControl(new mapboxgl.ScaleControl({ maxWidth: 100 }), 'bottom-left');
  map.on('idle', updateBuildingClearance);
  let tileError = false;
  map.on('error', event => {
    console.error(event.error);
    tileError = true;
    $('#status').textContent = 'Mapa Mapbox niedostępna · Sprawdź token, dostęp do stylu i połączenie.';
    $('#status').classList.add('error');
  });
  map.on('load', () => {
    map.addLayer(trafficLayer);
    for (const node of nodes) {
      const element = document.createElement('button');
      element.className = 'node-label';
      element.addEventListener('click', e => {
        e.stopPropagation();
        selectedNode = selectedNode === node.id ? null : node.id;
        update();
      });
      const marker = new mapboxgl.Marker({ element, anchor: 'bottom', offset: [0, -3],
        pitchAlignment: 'viewport', rotationAlignment: 'viewport' }).setLngLat(node.coords).addTo(map);
      markers.set(node.id, marker);
    }
    if (!tileError) $('#status').textContent = '';
    fitNetwork(false);
    update();
  });
  map.on('movestart', () => { $('#tooltip').hidden = true; });
  // Hover picking is limited to one raycast per animation frame, and only
  // happens while a pointer moves. It never schedules a render loop.
  let pendingHover = null, hoverFrame = null;
  map.on('mousemove', event => {
    pendingHover = event.point;
    if (hoverFrame !== null) return;
    hoverFrame = requestAnimationFrame(() => {
      hoverFrame = null;
      const point = pendingHover;
      const flow = pickFlow(point);
      const tip = $('#tooltip');
      map.getCanvas().style.cursor = flow ? 'pointer' : '';
      if (!flow) { tip.hidden = true; return; }
      const mode = modeById.get(flow.mode);
      tip.replaceChildren();
      const title = document.createElement('div');
      title.textContent = `${nodeById.get(flow.source).name} → ${nodeById.get(flow.target).name}`;
      const count = document.createElement('strong');
      count.style.color = mode.color;
      count.textContent = `${format.format(flow.value)} ${mode.unitLabel} · ${mode.name}`;
      tip.append(title, count);
      tip.hidden = false;
      tip.style.left = `${Math.max(8, Math.min(point.x + 16, map.getContainer().clientWidth - tip.offsetWidth - 12))}px`;
      tip.style.top = `${Math.max(8, Math.min(point.y + 16, map.getContainer().clientHeight - tip.offsetHeight - 12))}px`;
    });
  });
  map.getCanvas().addEventListener('mouseleave', () => {
    if (hoverFrame !== null) cancelAnimationFrame(hoverFrame);
    hoverFrame = null;
    $('#tooltip').hidden = true;
    map.getCanvas().style.cursor = '';
  });
  map.on('click', event => {
    const flow = pickFlow(event.point);
    selectedNode = flow ? flow.source : null;
    if (flow) selectedMode = flow.mode;
    update();
  });
}

function pickFlow(point) {
  if (view === '2d') return pickTrajectoryFlow(point);
  if (!cameraReady || !batches) return null;
  const x = point.x / map.getContainer().clientWidth * 2 - 1;
  const y = 1 - point.y / map.getContainer().clientHeight * 2;
  const near = new THREE.Vector3(x, y, -1).applyMatrix4(inverse);
  const far = new THREE.Vector3(x, y, 1).applyMatrix4(inverse);
  raycaster.ray.set(near, far.sub(near).normalize());
  const hits = raycaster.intersectObjects(batches.filter(m => m.visible), false);
  for (const hit of hits) {
    const flow = hit.object.userData.faces[hit.faceIndex];
    if ((!selectedMode || flow.mode === selectedMode) &&
      (!selectedNode || flow.source === selectedNode || flow.target === selectedNode)) return flow;
  }
  return null;
}

// Pick among 44 route centerlines, rather than raycasting every cloud point.
function pickTrajectoryFlow(point) {
  if (!map || !batches) return null;
  let nearest = null, distance = 9;
  for (const flow of filteredFlows()) {
    const a = map.project(nodeById.get(flow.source).coords), b = map.project(nodeById.get(flow.target).coords);
    const dx = b.x - a.x, dy = b.y - a.y, squared = dx * dx + dy * dy;
    if (!squared) continue;
    const t = Math.max(0, Math.min(1, ((point.x - a.x) * dx + (point.y - a.y) * dy) / squared));
    const center = trajectoryCenter(flow, points, t);
    const coord = new mapboxgl.MercatorCoordinate(origin.x + center[0] * units, origin.y + center[1] * units);
    const screen = map.project(coord.toLngLat());
    const d = Math.hypot(screen.x - point.x, screen.y - point.y);
    if (d < distance) { distance = d; nearest = flow; }
  }
  return nearest;
}

function filteredFlows() {
  return flows.filter(f => (!selectedMode || f.mode === selectedMode) &&
    (!selectedNode || f.source === selectedNode || f.target === selectedNode));
}

const totals = summarize(flows);
for (const mode of modes) {
  const button = document.createElement('button');
  button.className = 'mode-button';
  button.dataset.mode = mode.id;
  button.style.setProperty('--color', mode.color);
  button.innerHTML = `<span class="swatch"></span><span class="mode-name">${mode.name}</span><span class="mode-value">${format.format(totals[mode.id].total)}<small>${mode.unitLabel} · na połączeniach</small></span>`;
  button.addEventListener('click', () => {
    selectedMode = selectedMode === mode.id ? null : mode.id;
    update();
  });
  $('#modes').append(button);
}
for (const node of nodes) $('#location').add(new Option(node.name, node.id));
$('#location').addEventListener('change', e => { selectedNode = e.target.value || null; update(); });
$('#clear').addEventListener('click', () => { selectedMode = null; selectedNode = null; update(); });
$('#fit').addEventListener('click', () => fitNetwork());
document.querySelectorAll('[data-view]').forEach(button => button.addEventListener('click', () => {
  view = button.dataset.view;
  if (trafficLayer.renderer) switchGeometry();
  $('#tooltip').hidden = true;
  if (map) {
    if (view === '2d') map.dragRotate.disable(); else map.dragRotate.enable();
    map.touchZoomRotate.disableRotation();
  }
  fitNetwork();
  update();
}));
$('#export').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify({
    metadata: { estimated: true, method: 'Closed synthetic circulation: weighted forward branches and Trynek to Rynek return link; every node conserves every mode',
      fullNetworkConserved: true, closedCirculation: !selectedNode, bearingMode,
      filters: { mode: selectedMode, node: selectedNode },
      trafficMultiplier: TRAFFIC_MULTIPLIER,
      period: null, routeGeometry: false, countsAreLinkMovementsNotUniqueTrips: true,
      units: Object.fromEntries(modes.map(m => [m.id, m.unit])) },
    nodes: nodes.map(({ id, name, coords }) => ({ id, name, coords })), flows: filteredFlows(),
  }, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url; link.download = 'gliwice-przeplywy-demo.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

function update() {
  document.querySelectorAll('[data-view]').forEach(b => b.setAttribute('aria-pressed', b.dataset.view === view));
  document.querySelectorAll('[data-mode]').forEach(b => {
    b.setAttribute('aria-pressed', !selectedMode || selectedMode === b.dataset.mode);
    b.classList.toggle('dim', selectedMode !== null && selectedMode !== b.dataset.mode);
  });
  $('#location').value = selectedNode || '';
  $('#orbit-help').hidden = view !== '3d';
  $('#view-description').textContent = view === '3d'
    ? 'Wysokość wstęgi odpowiada natężeniu ruchu. Kolor oznacza rodzaj transportu.'
    : 'Zagęszczenie punktów odpowiada natężeniu ruchu. Proste połączenia schematyczne; bez tras GPS.';
  $('#scale-text').textContent = view === '3d'
    ? `Wysokość wstęgi: 100 przemieszczeń = ${format.format(100 * HEIGHT_SCALE)} m · Wspólna skala liniowa`
    : `Do ${POINTS_PER_MOVEMENT} punktów na przemieszczenie; wspólne ograniczenie liczby punktów dla dużych zbiorów.`;
  $('#elevation-note').hidden = view !== '3d';
  $('#elevation-note').textContent = `Poziom wstęg: ${format.format(baseElevation)} m · odstęp nad budynkami: min. 20 m`;
  const selected = selectedNode ? nodeById.get(selectedNode) : null;
  const summary = selected ? summarize(flows, selectedNode) : null;
  const detail = $('#details');
  detail.replaceChildren();
  if (selected) {
    const grid = document.createElement('div');
    grid.className = 'count-grid';
    grid.innerHTML = '<span class="heading">Rodzaj / jednostka</span><span class="heading numeric">Napływ</span><span class="heading numeric">Odpływ</span>';
    for (const mode of modes.filter(m => !selectedMode || m.id === selectedMode)) {
      grid.innerHTML += `<span style="color:${mode.color}">${mode.name} / ${mode.unitLabel}</span><span class="numeric">${format.format(summary[mode.id].incoming)}</span><span class="numeric">${format.format(summary[mode.id].outgoing)}</span>`;
    }
    detail.append(grid);
  } else {
    detail.innerHTML = '<p class="node-info">Wybierz punkt, aby zobaczyć napływ i odpływ.</p>';
  }
  for (const node of nodes) {
    const marker = markers.get(node.id);
    if (!marker) continue;
    const element = marker.getElement();
    element.textContent = node.name;
    element.classList.toggle('selected', selectedNode === node.id);
    element.setAttribute('aria-pressed', String(selectedNode === node.id));
    element.setAttribute('aria-label', node.name);
  }
  updateMarkerAltitudes();
  const visible = filteredFlows();
  const flowWord = { one: 'przepływ', few: 'przepływy', many: 'przepływów', other: 'przepływu' }[plurals.select(visible.length)];
  $('#connection-count').textContent = `${format.format(visible.length)} ${flowWord}`;
  const rows = $('#flow-rows'); rows.replaceChildren();
  for (const flow of visible.toSorted((a, b) => b.value - a.value)) {
    const row = document.createElement('tr');
    const mode = modeById.get(flow.mode);
    for (const value of [`${nodeById.get(flow.source).name} → ${nodeById.get(flow.target).name}`, mode.name, `${format.format(flow.value)} ${mode.unitLabel}`]) {
      const td = document.createElement('td'); td.textContent = value; row.append(td);
    }
    row.children[1].style.color = mode.color;
    rows.append(row);
  }
  if (batches) recolor(batches, selectedMode, selectedNode);
  map?.triggerRepaint();
}

// Read-only diagnostics for profiling, with no continuous timers or HUD updates.
window.trafficDebug = () => ({ view, bearingMode, selectedMode, selectedNode, frameCount,
  baseElevation,
  trafficMultiplier: TRAFFIC_MULTIPLIER, verticalScale: HEIGHT_SCALE,
  flowCount: flows.length, visibleFlows: filteredFlows().length,
  trajectoryPoints: view === '2d' ? batches?.reduce((sum, cloud) => sum + cloud.userData.pointCount, 0) : 0,
  drawCalls: trafficLayer.renderer?.info.render.calls,
  triangles: trafficLayer.renderer?.info.render.triangles,
  geometries: trafficLayer.renderer?.info.memory.geometries,
  versions: { mapbox: mapboxgl.version, three: THREE.REVISION },
});
window.addEventListener('pagehide', event => { if (!event.persisted) map?.remove(); });
if (import.meta.hot) import.meta.hot.dispose(() => map?.remove());
update();
