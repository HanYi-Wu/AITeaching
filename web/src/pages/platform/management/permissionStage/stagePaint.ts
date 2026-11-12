/* ============================================================
   权限星图 Canvas 高性能绘制引擎（贴合项目 or-g53 设计语言）：
   - 零模糊开销径向投影（杜绝 ctx.shadowBlur 首屏卡顿）
   - 批量绘制 48 齿比例刻度环（仅 2 次 stroke 调用）
   - 干净克制的单色 + 主色（--or-primary）精密连接线
   ============================================================ */
import type { Cat } from "./stageScene";

export type RGB = string;

export type StagePalette = {
  user: RGB;
  role: RGB;
  menu: RGB;
  permission: RGB;
  ink: RGB;
  accent: RGB;
  danger: RGB;
  paper: RGB;
  orb: [RGB, RGB, RGB];
};

function parsePrimaryRgb(value: string): RGB | null {
  const color = value.trim();
  const hex = color.match(/^#([\da-f]{3}|[\da-f]{6}|[\da-f]{8})$/i)?.[1];
  if (hex) {
    const expanded = hex.length === 3
      ? hex.split("").map((channel) => channel + channel).join("")
      : hex.slice(0, 6);
    return [0, 2, 4]
      .map((index) => Number.parseInt(expanded.slice(index, index + 2), 16))
      .join(", ");
  }

  const rgb = color.match(/^rgba?\((.*)\)$/i)?.[1];
  if (!rgb) return null;
  const channels = rgb.split("/")[0].replace(/,/g, " ").trim().split(/\s+/).slice(0, 3);
  if (channels.length !== 3) return null;

  const parsed = channels.map((channel) => {
    const match = channel.match(/^([+-]?(?:\d+\.?\d*|\.\d+))(%)?$/);
    if (!match) return null;
    const numeric = Number(match[1]) * (match[2] ? 255 / 100 : 1);
    return Math.round(Math.max(0, Math.min(255, numeric)));
  });
  if (parsed.some((channel) => channel === null)) return null;
  return parsed.join(", ");
}

export function readStagePalette(el: Element): StagePalette {
  const css = getComputedStyle(el);
  const value = (name: string, fallback: RGB) => css.getPropertyValue(name).trim() || fallback;
  const primary = parsePrimaryRgb(css.getPropertyValue("--or-primary"));
  return {
    user: primary ?? value("--pe-user", "0, 122, 255"),
    role: primary ?? value("--pe-role", "0, 122, 255"),
    menu: primary ?? value("--pe-menu", "0, 122, 255"),
    permission: primary ?? value("--pe-permission", "0, 122, 255"),
    ink: value("--pe-ink", "32, 32, 36"),
    accent: primary ?? value("--pe-accent", "0, 122, 255"),
    danger: value("--pe-danger", "186, 44, 59"),
    paper: value("--pe-paper", "255, 251, 255"),
    orb: [
      value("--pe-orb-1", "255, 255, 255"),
      value("--pe-orb-2", "241, 238, 243"),
      value("--pe-orb-3", "220, 216, 224"),
    ],
  };
}

export const catColor = (p: StagePalette, cat?: Cat, tone?: string) => {
  if (tone === "danger") return p.danger;
  if (!cat) return p.accent;
  return p[cat];
};

const TAU = Math.PI * 2;
const rgba = (c: RGB, a: number) => `rgba(${c}, ${Math.max(0, Math.min(1, a))})`;

/** 批量绘制表盘刻度环（仅 2 次 stroke 调用，零掉帧）。 */
function tickRingBatched(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  length: number,
  count: number,
  base: string,
  lit: string,
  ratio: number,
  width: number,
) {
  ctx.lineCap = "round";
  ctx.lineWidth = width;
  const litCount = Math.round(count * Math.max(0, Math.min(1, ratio)));
  const rOuter = radius + length;

  if (litCount > 0) {
    ctx.strokeStyle = lit;
    ctx.beginPath();
    for (let i = 0; i < litCount; i += 1) {
      const angle = -Math.PI / 2 + (i / count) * TAU;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(x + cos * radius, y + sin * radius);
      ctx.lineTo(x + cos * rOuter, y + sin * rOuter);
    }
    ctx.stroke();
  }

  if (litCount < count) {
    ctx.strokeStyle = base;
    ctx.beginPath();
    for (let i = litCount; i < count; i += 1) {
      const angle = -Math.PI / 2 + (i / count) * TAU;
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      ctx.moveTo(x + cos * radius, y + sin * radius);
      ctx.lineTo(x + cos * rOuter, y + sin * rOuter);
    }
    ctx.stroke();
  }
}

/** 零模糊开销的径向渐变投影。 */
function paintSoftDropShadow(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  ink: RGB,
  strength: number,
) {
  const sy = y + r * 0.12;
  const outer = r * 1.28;
  const grad = ctx.createRadialGradient(x, sy, r * 0.62, x, sy, outer);
  grad.addColorStop(0, rgba(ink, strength));
  grad.addColorStop(0.55, rgba(ink, strength * 0.34));
  grad.addColorStop(1, rgba(ink, 0));
  ctx.fillStyle = grad;
  ctx.beginPath();
  ctx.arc(x, sy, outer, 0, TAU);
  ctx.fill();
}

/* ── 背景同心星轨（赋予全景层层次感，克制不杂乱） ── */
export function paintOrbitGuides(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  orbitR: number,
  p: StagePalette,
  alpha: number,
) {
  if (alpha <= 0.02) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  ctx.strokeStyle = rgba(p.ink, 0.06);
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 7]);
  ctx.beginPath();
  ctx.arc(cx, cy, orbitR, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = rgba(p.ink, 0.04);
  ctx.setLineDash([2, 10]);
  ctx.beginPath();
  ctx.arc(cx, cy, orbitR * 1.68, 0, TAU);
  ctx.stroke();

  ctx.restore();
}

/* ── 中心球：柔和立体球面 + 细密刻度外环 ── */
export function paintOrb(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  p: StagePalette,
  alpha: number,
  active = false,
) {
  if (alpha <= 0.01 || r <= 2) return;
  ctx.save();
  ctx.globalAlpha = alpha;

  const ringR = r * 1.22;
  tickRingBatched(
    ctx,
    x,
    y,
    ringR,
    4.5,
    48,
    rgba(p.ink, 0.1),
    rgba(p.accent, active ? 0.55 : 0.28),
    active ? 0.5 : 0.25,
    1.15,
  );

  paintSoftDropShadow(ctx, x, y, r, p.ink, 0.14);

  const body = ctx.createRadialGradient(x - r * 0.32, y - r * 0.36, r * 0.06, x, y, r);
  body.addColorStop(0, rgba(p.orb[0], 1));
  body.addColorStop(0.62, rgba(p.orb[1], 1));
  body.addColorStop(1, rgba(p.orb[2], 1));
  ctx.fillStyle = body;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  const sheen = ctx.createRadialGradient(
    x - r * 0.35,
    y - r * 0.35,
    0,
    x - r * 0.2,
    y - r * 0.2,
    r * 0.85,
  );
  sheen.addColorStop(0, rgba(p.accent, active ? 0.18 : 0.1));
  sheen.addColorStop(1, rgba(p.accent, 0));
  ctx.fillStyle = sheen;
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.fill();

  ctx.lineWidth = 1.1;
  ctx.strokeStyle = active ? rgba(p.accent, 0.45) : rgba(p.ink, 0.14);
  ctx.beginPath();
  ctx.arc(x, y, r, 0, TAU);
  ctx.stroke();

  ctx.strokeStyle = rgba(p.orb[0], 0.72);
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(x, y, r * 0.84, Math.PI * 1.1, Math.PI * 1.45);
  ctx.stroke();

  ctx.restore();
}

/* ── 刻度表盘：48 齿比例刻度环 + 柔和激活态 ── */
export function paintDial(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  size: number,
  color: RGB,
  p: StagePalette,
  opts: { alpha: number; ratio?: number; active?: boolean },
) {
  if (opts.alpha <= 0.01 || size <= 4) return;
  const R = size / 2;
  const ratio = Math.max(0, Math.min(1, opts.ratio ?? 1));
  ctx.save();
  ctx.globalAlpha = opts.alpha;

  if (opts.active) {
    const halo = ctx.createRadialGradient(x, y, R * 0.86, x, y, R + 18);
    halo.addColorStop(0, rgba(color, 0.18));
    halo.addColorStop(1, rgba(color, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(x, y, R + 18, 0, TAU);
    ctx.fill();
  }

  paintSoftDropShadow(ctx, x, y, R, p.ink, 0.11);

  ctx.fillStyle = rgba(p.paper, 0.98);
  ctx.beginPath();
  ctx.arc(x, y, R, 0, TAU);
  ctx.fill();

  ctx.lineWidth = opts.active ? 1.5 : 1.1;
  ctx.strokeStyle = opts.active ? rgba(color, 0.62) : rgba(p.ink, 0.13);
  ctx.beginPath();
  ctx.arc(x, y, R - 0.5, 0, TAU);
  ctx.stroke();

  const count = size > 86 ? 44 : 32;
  tickRingBatched(
    ctx,
    x,
    y,
    R * 0.74,
    Math.max(3.5, R * 0.1),
    count,
    rgba(p.ink, 0.12),
    rgba(color, opts.active ? 0.95 : 0.78),
    ratio,
    size > 86 ? 1.45 : 1.2,
  );

  ctx.restore();
}

export type Curve = {
  x1: number;
  y1: number;
  c1x: number;
  c1y: number;
  c2x: number;
  c2y: number;
  x2: number;
  y2: number;
};

/* ── 平滑三次贝塞尔连线 ── */
export function paintThread(
  ctx: CanvasRenderingContext2D,
  g: Curve,
  colorA: RGB,
  colorB: RGB,
  alpha: number,
  width: number,
  dashed = false,
  withEndpoints = false,
) {
  if (alpha <= 0.01) return;
  ctx.save();
  ctx.lineCap = "round";
  if (dashed) ctx.setLineDash([5, 5]);

  const grad = ctx.createLinearGradient(g.x1, g.y1, g.x2, g.y2);
  grad.addColorStop(0, rgba(colorA, alpha));
  grad.addColorStop(1, rgba(colorB, alpha));

  ctx.beginPath();
  ctx.moveTo(g.x1, g.y1);
  ctx.bezierCurveTo(g.c1x, g.c1y, g.c2x, g.c2y, g.x2, g.y2);
  ctx.strokeStyle = grad;
  ctx.lineWidth = width;
  ctx.stroke();

  if (withEndpoints) {
    ctx.setLineDash([]);
    ctx.fillStyle = rgba(colorA, Math.min(1, alpha * 1.15));
    ctx.beginPath();
    ctx.arc(g.x1, g.y1, 2.2, 0, TAU);
    ctx.fill();

    ctx.fillStyle = rgba(colorB, Math.min(1, alpha * 1.15));
    ctx.beginPath();
    ctx.arc(g.x2, g.y2, 2.2, 0, TAU);
    ctx.fill();
  }

  ctx.restore();
}
