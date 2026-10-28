export const modes = [
  { id: 'car', name: 'Samochody', unit: 'vehicles', unitLabel: 'poj.', color: '#ff3355' },
  { id: 'bus', name: 'Autobusy', unit: 'vehicles', unitLabel: 'poj.', color: '#3395ff' },
  { id: 'bicycle', name: 'Rowery', unit: 'bicycles', unitLabel: 'row.', color: '#00e676' },
  { id: 'pedestrian', name: 'Piesi', unit: 'people', unitLabel: 'os.', color: '#ffce00' },
];

export const TRAFFIC_MULTIPLIER = 2;

// Synthetic closed circulation. Original vectors weight the forward branches;
// Trynek returns the same per-mode throughput to Rynek to close every circuit.
export const CIRCULATION_LINK = { source: 'trynek', target: 'rynek' };
export const nodes = [
  { id: 'rynek', name: 'Rynek', coords: [18.6710, 50.2945], counts: [500, 250, 150, 100], to: [1, 3, 5] },
  { id: 'politechnika', name: 'Politechnika Śląska', coords: [18.6775, 50.2904], counts: [300, 350, 250, 200], to: [2, 3] },
  { id: 'labedy', name: 'Łabędy', coords: [18.6570, 50.3281], counts: [600, 200, 50, 50], to: [4] },
  { id: 'arena', name: 'Arena Gliwice', coords: [18.6843, 50.3045], counts: [550, 300, 200, 150], to: [4, 5] },
  { id: 'radiostacja', name: 'Radiostacja', coords: [18.6346, 50.2982], counts: [400, 150, 100, 75], to: [6] },
  { id: 'park', name: 'Park Chopina', coords: [18.6655, 50.2866], counts: [350, 180, 130, 90], to: [6] },
  { id: 'trynek', name: 'Trynek', coords: [18.6527, 50.2754], counts: [300, 120, 80, 60], to: [0] },
];

// Largest remainder preserves each source's integer total, without pretending
// that fractional vehicles or destination weights are observed journeys.
export function allocate(total, weights) {
  if (!Number.isSafeInteger(total) || total < 0 || weights.some(w => !Number.isFinite(w) || w < 0)) {
    throw new Error('Allocation requires a nonnegative integer total and finite nonnegative weights.');
  }
  const sum = weights.reduce((a, b) => a + b, 0);
  if (!sum) return weights.map(() => 0);
  const exact = weights.map(w => total * w / sum);
  const result = exact.map(Math.floor);
  const order = exact.map((v, i) => ({ i, remainder: v - result[i] }))
    .sort((a, b) => b.remainder - a.remainder || a.i - b.i);
  const remaining = total - result.reduce((a, b) => a + b, 0);
  for (let i = 0; i < remaining; i++) result[order[i].i]++;
  return result;
}

export function createDemoFlows(trafficMultiplier = TRAFFIC_MULTIPLIER) {
  if (!Number.isSafeInteger(trafficMultiplier) || trafficMultiplier < 1) {
    throw new Error('Traffic multiplier must be a positive integer.');
  }
  const result = [];
  const entry = nodes.findIndex(n => n.id === CIRCULATION_LINK.target);
  const exit = nodes.findIndex(n => n.id === CIRCULATION_LINK.source);
  // Construct a balanced forward pass, then close it with a return connection.
  // This does not iteratively circulate or inflate the counts on each pass.
  const forward = nodes.map((n, i) => n.to.filter(j => !(i === exit && j === entry)));
  const arrivals = nodes.map(() => modes.map(() => 0));
  const indegree = nodes.map(() => 0);
  forward.forEach(destinations => destinations.forEach(i => indegree[i]++));
  const queue = nodes.flatMap((_, i) => indegree[i] === 0 ? [i] : []);
  let visited = 0;
  // Seed the circulation throughput once; all forward junctions redistribute it.
  for (let q = 0; q < queue.length; q++) {
    const i = queue[q], source = nodes[i];
    modes.forEach((mode, m) => {
      const total = i === entry ? source.counts[m] * trafficMultiplier : arrivals[i][m];
      const values = allocate(total, forward[i].map(j => nodes[j].counts[m]));
      forward[i].forEach((destination, j) => {
        arrivals[destination][m] += values[j];
        if (values[j]) result.push({
          id: `${source.id}-${nodes[destination].id}-${mode.id}`,
          source: source.id, target: nodes[destination].id,
          mode: mode.id, value: values[j], estimated: true,
        });
      });
    });
    for (const j of forward[i]) if (--indegree[j] === 0) queue.push(j);
    visited++;
  }
  if (visited !== nodes.length) throw new Error('The demo forward graph must be acyclic after removing the return link.');
  modes.forEach((mode, m) => {
    result.push({ id: `${CIRCULATION_LINK.source}-${CIRCULATION_LINK.target}-${mode.id}`,
      ...CIRCULATION_LINK, value: arrivals[exit][m], mode: mode.id,
      estimated: true, circulationReturn: true });
  });
  return validateConservation(result);
}

export function validateFlows(flows, locations = nodes) {
  const ids = new Set(locations.map(n => n.id));
  const seen = new Set();
  for (const f of flows) {
    if (!f.id || seen.has(f.id) || !ids.has(f.source) || !ids.has(f.target) || f.source === f.target ||
      !modes.some(m => m.id === f.mode) || !Number.isSafeInteger(f.value) || f.value <= 0) {
      throw new Error(`Invalid flow: ${JSON.stringify(f)}`);
    }
    seen.add(f.id);
  }
  return flows;
}

export function summarize(flows, nodeId = null) {
  return Object.fromEntries(modes.map(mode => {
    const matching = flows.filter(f => f.mode === mode.id);
    return [mode.id, {
      incoming: matching.filter(f => f.target === nodeId).reduce((s, f) => s + f.value, 0),
      outgoing: matching.filter(f => f.source === nodeId).reduce((s, f) => s + f.value, 0),
      total: matching.reduce((s, f) => s + f.value, 0),
    }];
  }));
}

export function validateConservation(flows, locations = nodes) {
  for (const node of locations) {
    const summary = summarize(flows, node.id);
    for (const mode of modes) {
      const { incoming, outgoing } = summary[mode.id];
      if (incoming !== outgoing) {
        throw new Error(`Unbalanced circulation at ${node.id}/${mode.id}: in=${incoming}, out=${outgoing}`);
      }
    }
  }
  return flows;
}

export const flows = validateConservation(validateFlows(createDemoFlows()));
