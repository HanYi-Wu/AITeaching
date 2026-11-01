/**
 * OriginReach Design System Tokens
 * Inspired by FlClash design language and Material/iOS Human Interface Guidelines.
 */

export const ACCENT_COLORS = {
  blue: "#007AFF",
  purple: "#CB30E0",
  pink: "#FF2D55",
  red: "#FF383C",
  orange: "#FF8D28",
  yellow: "#FFCC00",
  green: "#34C759",
  gray: "#8E8E93",
  black: "#000000",
} as const;

export type AccentColorKey = keyof typeof ACCENT_COLORS;
