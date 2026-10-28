export const MIN_RIBBON_ELEVATION = 30;
export const BUILDING_CLEARANCE = 20;

// Preserve one level across the network. Never lower it while panning: newly
// loaded taller buildings can only raise the entire 3D flow plane.
export function ribbonElevation(heights, current = MIN_RIBBON_ELEVATION) {
  let result = Math.max(MIN_RIBBON_ELEVATION, current);
  for (const height of heights) {
    const value = Number(height);
    if (Number.isFinite(value) && value >= 0) result = Math.max(result, value + BUILDING_CLEARANCE);
  }
  return result;
}
