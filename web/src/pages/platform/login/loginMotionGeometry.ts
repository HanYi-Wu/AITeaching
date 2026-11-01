export const LOGIN_DOOR_NORMAL_X = 0.9841;
export const LOGIN_DOOR_NORMAL_Y = 0.1771;
export const LOGIN_DOOR_MAX_DISTANCE = 825;
export const LOGIN_DOOR_CRACK_DISTANCE = 13;

export function easeOutQuart(value: number): number {
  return 1 - Math.pow(1 - value, 4);
}

export function easeOutQuint(value: number): number {
  return 1 - Math.pow(1 - value, 5);
}

export function easeTectonicPart(value: number): number {
  const clamped = Math.max(0, Math.min(1, value));
  if (clamped < 0.18) return 2.6 * clamped * clamped;
  const remaining = Math.max(0, 1 - (clamped - 0.18) / 0.82);
  return 1 - Math.pow(remaining, 4.2) * (1 - 2.6 * 0.18 * 0.18);
}

export function getLoginDoorOffsets(distance: number) {
  return {
    x: distance * LOGIN_DOOR_NORMAL_X,
    y: distance * LOGIN_DOOR_NORMAL_Y,
  };
}

export function getLoginDoorPartingDistance(progress: number): number {
  return LOGIN_DOOR_CRACK_DISTANCE
    + (LOGIN_DOOR_MAX_DISTANCE - LOGIN_DOOR_CRACK_DISTANCE) * easeTectonicPart(progress);
}
