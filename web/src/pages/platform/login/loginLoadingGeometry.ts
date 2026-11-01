export const LOGIN_LOADING_DOTS = {
  stageWidth: 80,
  stageHeight: 28,
  centerX: 40,
  centerY: 14,
  centerRadius: 10.4,
  satelliteRadius: 6.7,
  travelAmplitude: 26.8,
  periodMs: 1180,
  startDelayMs: 140,
  bridgeMaxDistance: 22.8,
  bridgeBaseTaper: 0.62,
  bridgeHandleLengthRate: 2.4,
} as const;

export type LoginLoadingGeometry = {
  centerOffsetX: number;
  centerRadius: number;
  satelliteOffsetX: number;
  satelliteRadius: number;
  bridgePath: string | null;
};

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function format(value: number): string {
  const rounded = Math.round(value * 1000) / 1000;
  return Object.is(rounded, -0) ? "0" : String(rounded);
}

export function getLoginLoadingOffset(elapsedMs: number): number {
  if (!Number.isFinite(elapsedMs)) return 0;
  const phase = (2 * Math.PI * Math.max(0, elapsedMs - LOGIN_LOADING_DOTS.startDelayMs)) / LOGIN_LOADING_DOTS.periodMs;
  return LOGIN_LOADING_DOTS.travelAmplitude * Math.sin(phase);
}

function buildBridge(dx: number, centerOffsetX: number, r1: number): string | null {
  const { satelliteRadius: r2, bridgeBaseTaper, bridgeHandleLengthRate } = LOGIN_LOADING_DOTS;
  const bridgeMaxDistance = LOGIN_LOADING_DOTS.bridgeMaxDistance - 1;
  const distance = Math.abs(dx - centerOffsetX);
  const innerDistance = r1 - r2;
  const overlapDistance = r1 + r2;

  if (distance <= innerDistance || distance >= bridgeMaxDistance) return null;

  let u1 = 0;
  let u2 = 0;
  if (distance < overlapDistance) {
    u1 = Math.acos(
      clamp((r1 * r1 + distance * distance - r2 * r2) / (2 * r1 * distance), -1, 1),
    );
    u2 = Math.acos(
      clamp((r2 * r2 + distance * distance - r1 * r1) / (2 * r2 * distance), -1, 1),
    );
  }

  const maxSpread = Math.acos(clamp((r1 - r2) / distance, -1, 1));
  let taper = bridgeBaseTaper;
  if (distance > overlapDistance) {
    const progress = clamp((distance - overlapDistance) / (bridgeMaxDistance - overlapDistance), 0, 1);
    taper *= 1 - Math.pow(progress, 1.35) * 0.93;
  }

  const a1 = u1 + (maxSpread - u1) * taper;
  const a3 = Math.PI - u2 - (Math.PI - u2 - maxSpread) * taper;

  const p1x = r1 * Math.cos(a1);
  const p1y = r1 * Math.sin(a1);
  const p3x = distance + r2 * Math.cos(a3);
  const p3y = r2 * Math.sin(a3);

  const controlSpan = Math.hypot(p1x - p3x, p1y - p3y);
  const handleScale =
    Math.min(taper * bridgeHandleLengthRate, controlSpan / overlapDistance) *
    Math.min(1, (distance * 2) / overlapDistance);
  const handle1Radius = r1 * handleScale;
  const handle2Radius = r2 * handleScale;

  const handle1x = p1x + handle1Radius * Math.sin(a1);
  const handle1y = Math.max(0.16, p1y - handle1Radius * Math.cos(a1));
  const handle2x = p3x - handle2Radius * Math.sin(a3);
  const handle2y = Math.max(0.16, p3y + handle2Radius * Math.cos(a3));
  const sign = dx < 0 ? -1 : 1;
  const sx = (x: number) => format(centerOffsetX + sign * x);
  const sy = (y: number) => format(y);

  return [
    "M", sx(p1x), sy(p1y),
    "C", sx(handle1x), sy(handle1y), sx(handle2x), sy(handle2y), sx(p3x), sy(p3y),
    "L", sx(p3x), sy(-p3y),
    "C", sx(handle2x), sy(-handle2y), sx(handle1x), sy(-handle1y), sx(p1x), sy(-p1y),
    "Z",
  ].join(" ");
}

export function computeLoginLoadingGeometry(dx: number): LoginLoadingGeometry {
  const safeOffset = Number.isFinite(dx)
    ? clamp(dx, -LOGIN_LOADING_DOTS.travelAmplitude, LOGIN_LOADING_DOTS.travelAmplitude)
    : 0;
  const distance = Math.abs(safeOffset);
  const pullPhase = distance < LOGIN_LOADING_DOTS.bridgeMaxDistance
    ? Math.sin(Math.PI * distance / LOGIN_LOADING_DOTS.bridgeMaxDistance)
    : 0;
  const centerOffsetX = Math.sign(safeOffset) * 1.35 * pullPhase;
  const centerRadius = LOGIN_LOADING_DOTS.centerRadius - 0.9 * Math.min(1, distance / 18);

  return {
    centerOffsetX,
    centerRadius,
    satelliteOffsetX: safeOffset,
    satelliteRadius: distance < 0.25 ? 0 : LOGIN_LOADING_DOTS.satelliteRadius,
    bridgePath: buildBridge(safeOffset, centerOffsetX, centerRadius),
  };
}

export function computeMetaballBridgePath(dx: number): string | null {
  return computeLoginLoadingGeometry(dx).bridgePath;
}
