import { describe, expect, it } from "vitest";
import {
  computeLoginLoadingGeometry,
  computeMetaballBridgePath,
  getLoginLoadingOffset,
  LOGIN_LOADING_DOTS,
} from "./loginLoadingGeometry";

function coordinates(path: string): number[] {
  return (path.match(/-?\d+(?:\.\d+)?/g) ?? []).map(Number);
}

describe("login loading dot geometry", () => {
  it("holds briefly before the 1.18 second left-right cycle", () => {
    const delay = LOGIN_LOADING_DOTS.startDelayMs;
    expect(getLoginLoadingOffset(0)).toBeCloseTo(0, 8);
    expect(getLoginLoadingOffset(delay)).toBeCloseTo(0, 8);
    expect(getLoginLoadingOffset(delay + LOGIN_LOADING_DOTS.periodMs / 4)).toBeCloseTo(26.8, 8);
    expect(getLoginLoadingOffset(delay + LOGIN_LOADING_DOTS.periodMs / 2)).toBeCloseTo(0, 8);
    expect(getLoginLoadingOffset(delay + (LOGIN_LOADING_DOTS.periodMs * 3) / 4)).toBeCloseTo(-26.8, 8);
    expect(getLoginLoadingOffset(delay + LOGIN_LOADING_DOTS.periodMs)).toBeCloseTo(0, 8);
  });

  it("fuses at the center and releases the stretched satellite", () => {
    expect(computeMetaballBridgePath(0)).toBeNull();
    expect(computeLoginLoadingGeometry(0).satelliteRadius).toBe(0);
    expect(computeLoginLoadingGeometry(0).centerRadius).toBe(10.4);
    expect(computeMetaballBridgePath(12)).toMatch(/^M /);
    expect(computeMetaballBridgePath(20)).toMatch(/^M /);
    expect(computeMetaballBridgePath(LOGIN_LOADING_DOTS.bridgeMaxDistance)).toBeNull();
    expect(computeMetaballBridgePath(26.8)).toBeNull();
    expect(computeLoginLoadingGeometry(12).centerOffsetX).toBeGreaterThan(0);
    expect(computeLoginLoadingGeometry(12).centerRadius).toBeLessThan(10.4);
  });

  it("mirrors the right bridge to the left without changing its vertical contour", () => {
    const rightPath = computeMetaballBridgePath(12);
    const leftPath = computeMetaballBridgePath(-12);
    expect(rightPath).not.toBeNull();
    expect(leftPath).not.toBeNull();

    const right = coordinates(rightPath!);
    const left = coordinates(leftPath!);
    expect(left).toHaveLength(right.length);
    for (let index = 0; index < right.length; index += 2) {
      expect(left[index]).toBeCloseTo(-right[index], 2);
      expect(left[index + 1]).toBeCloseTo(right[index + 1], 2);
    }
  });

  it("produces finite bridge points throughout the measured travel range", () => {
    for (let dx = -26.8; dx <= 26.8; dx += 0.25) {
      const geometry = computeLoginLoadingGeometry(dx);
      expect(Number.isFinite(geometry.satelliteOffsetX)).toBe(true);
      expect(Math.abs(geometry.satelliteOffsetX) + geometry.satelliteRadius).toBeLessThan(40);
      if (geometry.bridgePath) {
        expect(geometry.bridgePath).not.toMatch(/NaN|Infinity/);
        expect(coordinates(geometry.bridgePath).every(Number.isFinite)).toBe(true);
      }
    }
  });
});
