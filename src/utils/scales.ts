export function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

export function extent(values: number[], pad = 0.08): [number, number] {
  if (values.length === 0) return [0, 1];
  const min = Math.min(...values);
  const max = Math.max(...values);
  if (min === max) {
    const span = Math.abs(min) || 1;
    return [min - span * 0.2, max + span * 0.2];
  }
  const range = max - min;
  return [min - range * pad, max + range * pad];
}

export function percentile(values: number[], p: number) {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const index = clamp((sorted.length - 1) * p, 0, sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  const weight = index - lower;
  return sorted[lower] * (1 - weight) + sorted[upper] * weight;
}

/** Symmetric log transform for heavy-tailed signed values. */
export function symlog(value: number, constant = 1) {
  return Math.sign(value) * Math.log1p(Math.abs(value) / constant);
}

export function linearScale(
  value: number,
  domain: [number, number],
  range: [number, number],
) {
  const [d0, d1] = domain;
  const [r0, r1] = range;
  if (d1 === d0) return (r0 + r1) / 2;
  return r0 + ((value - d0) / (d1 - d0)) * (r1 - r0);
}

export function symlogScale(
  value: number,
  domain: [number, number],
  range: [number, number],
  constant = 1,
) {
  return linearScale(
    symlog(value, constant),
    [symlog(domain[0], constant), symlog(domain[1], constant)],
    range,
  );
}

export function bubbleRadius(
  value: number,
  maxValue: number,
  minR = 6,
  maxR = 22,
) {
  if (maxValue <= 0) return minR;
  return minR + Math.sqrt(Math.max(value, 0) / maxValue) * (maxR - minR);
}

export function robustWidth(
  value: number,
  maxAbs: number,
  minWidth: number,
  maxWidth: number,
) {
  if (maxAbs <= 0) return minWidth;
  const ratio = Math.sqrt(Math.abs(value) / maxAbs);
  return minWidth + ratio * (maxWidth - minWidth);
}

export function median(values: number[]) {
  return percentile(values, 0.5);
}
