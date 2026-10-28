const TAU = Math.PI * 2;

export function angleStepForConnections(count) {
  if (!Number.isSafeInteger(count) || count < 0) throw new Error('Connection count must be a nonnegative integer.');
  if (count <= 8) return 45;
  if (count <= 12) return 30;
  if (count <= 24) return 15;
  // Continue subdividing for future points beyond the 24-port / 15° grid.
  return 15 / 2 ** Math.ceil(Math.log2(count / 24));
}

// Rectangular minimum-cost assignment: distinct angular slots, with the
// smallest total squared angular deviation from the desired target bearings.
// This avoids greedy assignments pushing the final connection to a bad angle.
function assignSlots(cost) {
  const n = cost.length, m = cost[0].length;
  const u = new Float64Array(n + 1), v = new Float64Array(m + 1);
  const matchedRow = new Int32Array(m + 1), previous = new Int32Array(m + 1);
  for (let row = 1; row <= n; row++) {
    matchedRow[0] = row;
    let column = 0;
    const minimum = new Float64Array(m + 1).fill(Infinity);
    const used = new Uint8Array(m + 1);
    do {
      used[column] = 1;
      const currentRow = matchedRow[column];
      let delta = Infinity, nextColumn = 0;
      for (let j = 1; j <= m; j++) if (!used[j]) {
        const value = cost[currentRow - 1][j - 1] - u[currentRow] - v[j];
        if (value < minimum[j] - 1e-12) { minimum[j] = value; previous[j] = column; }
        if (minimum[j] < delta - 1e-12) { delta = minimum[j]; nextColumn = j; }
      }
      for (let j = 0; j <= m; j++) {
        if (used[j]) { u[matchedRow[j]] += delta; v[j] -= delta; }
        else minimum[j] -= delta;
      }
      column = nextColumn;
    } while (matchedRow[column] !== 0);
    do {
      const nextColumn = previous[column];
      matchedRow[column] = matchedRow[nextColumn];
      column = nextColumn;
    } while (column !== 0);
  }
  const assigned = new Int32Array(n);
  for (let j = 1; j <= m; j++) if (matchedRow[j]) assigned[matchedRow[j] - 1] = j - 1;
  return assigned;
}

export function allocateBearingSlots(connections) {
  const ordered = [...connections].sort((a, b) => a.key < b.key ? -1 : a.key > b.key ? 1 : 0);
  if (new Set(ordered.map(c => c.key)).size !== ordered.length) throw new Error('Connection keys must be unique.');
  if (!ordered.length) return new Map();
  const stepDegrees = angleStepForConnections(ordered.length);
  const slots = Math.round(360 / stepDegrees), step = TAU / slots;
  const cost = ordered.map(({ dx, dy }) => {
    if (!Number.isFinite(dx) || !Number.isFinite(dy)) throw new Error('Bearing vectors must be finite.');
    const angle = Math.atan2(dy, dx);
    return Array.from({ length: slots }, (_, slot) => {
      const difference = Math.atan2(Math.sin(angle - slot * step), Math.cos(angle - slot * step));
      return difference * difference;
    });
  });
  const assigned = assignSlots(cost);
  return new Map(ordered.map((connection, i) => {
    const slot = assigned[i], angle = slot * step;
    return [connection.key, { x: Math.cos(angle), y: Math.sin(angle), stepDegrees, slot }];
  }));
}
