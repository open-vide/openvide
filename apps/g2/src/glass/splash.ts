import { createSplash, TILE_PRESETS } from 'even-toolkit/splash';

/**
 * OpenVide splash renderer — terminal-style logo + app name.
 * Single tile (200x100), top-center on display.
 * "CONNECTING..." shown as text in the menu container below.
 */
export function renderOpenVideSplash(ctx: CanvasRenderingContext2D, w: number, h: number) {
  const fg = '#e0e0e0';
  const dim = '#808080';
  const cx = w / 2;
  const s = Math.min(w / 200, h / 200);

  // ── Tile 1: Logo + Name (top 100px) ──
  const logoMidY = 35 * s;

  // Terminal cursor bracket: >_
  ctx.fillStyle = fg;
  ctx.font = `bold ${28 * s}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('>_', cx, logoMidY + 8 * s);

  // Blinking cursor line
  ctx.fillStyle = dim;
  ctx.fillRect(cx + 16 * s, logoMidY - 4 * s, 2 * s, 16 * s);

  // App name
  ctx.fillStyle = fg;
  ctx.font = `bold ${14 * s}px "Courier New", monospace`;
  ctx.textAlign = 'center';
  ctx.fillText('OPENVIDE', cx, 88 * s);

  ctx.textAlign = 'left';
}

/**
 * G2 glasses splash — 1 image tile (terminal logo + name) top-center,
 * "CONNECTING..." as centered text in the menu container below.
 */
export const openVideSplash = createSplash({
  tiles: 1,
  tileLayout: 'vertical',
  tilePositions: TILE_PRESETS.topCenter1,
  canvasSize: { w: 200, h: 200 },
  minTimeMs: 1500,
  maxTimeMs: 5000,
  menuText: '\n\n' + ' '.repeat(46) + 'CONNECTING...',
  render: renderOpenVideSplash,
});
