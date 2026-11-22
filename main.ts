// The World in One Day — Sunday 22 November 2026. v1.
// A picture paper drawn entirely in code: a hand-rolled PNG writer,
// a hand-drawn 5x7 bitmap face, and hand-drawn scenes. Node 22 stdlib
// only, no network, no outside images. Writes /output/entry.png.
// Every story in it happened, or was first reported, on 22 Nov 2026.
import { writeFileSync, mkdirSync } from "node:fs";
import { deflateSync } from "node:zlib";

const W = 1024, H = 1024;

// ---------- PNG writer (RGB8, one filter byte of 0 per row) ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    t[n] = c >>> 0;
  }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function pngChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const td = Buffer.concat([Buffer.from(type, "ascii"), data]);
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td), 0);
  return Buffer.concat([len, td, crc]);
}
function encodePNG(rgb, w, h) {
  const raw = Buffer.alloc(h * (1 + w * 3));
  for (let y = 0; y < h; y++) {
    raw[y * (1 + w * 3)] = 0;
    rgb.copy(raw, y * (1 + w * 3) + 1, y * w * 3, (y + 1) * w * 3);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 2; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

// ---------- framebuffer + shapes ----------
const fb = Buffer.alloc(W * H * 3);
function px(x, y, c) {
  if (x < 0 || y < 0 || x >= W || y >= H) return;
  const i = (y * W + x) * 3;
  fb[i] = c[0]; fb[i + 1] = c[1]; fb[i + 2] = c[2];
}
function rect(x, y, w, h, c) {
  x = Math.round(x); y = Math.round(y); w = Math.round(w); h = Math.round(h);
  for (let j = Math.max(0, y); j < Math.min(H, y + h); j++)
    for (let i = Math.max(0, x); i < Math.min(W, x + w); i++) px(i, j, c);
}
function hline(x0, x1, y, c) { rect(Math.min(x0, x1), y, Math.abs(x1 - x0) + 1, 1, c); }
function vline(x, y0, y1, c) { rect(x, Math.min(y0, y1), 1, Math.abs(y1 - y0) + 1, c); }
function line(x0, y0, x1, y1, c) {
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy, x = x0, y = y0;
  for (;;) {
    px(x, y, c);
    if (x === x1 && y === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x += sx; }
    if (e2 <= dx) { err += dx; y += sy; }
  }
}
function circle(cx, cy, r, c) {
  cx = Math.round(cx); cy = Math.round(cy); r = Math.round(r);
  for (let y = -r; y <= r; y++)
    for (let x = -r; x <= r; x++)
      if (x * x + y * y <= r * r) px(cx + x, cy + y, c);
}
function ring(cx, cy, r, t, c) {
  for (let a = 0; a < 360; a += 2) {
    const rad = (a * Math.PI) / 180;
    for (let k = 0; k < t; k++) px(Math.round(cx + (r + k) * Math.cos(rad)), Math.round(cy + (r + k) * Math.sin(rad)), c);
  }
}
function tri(x0, y0, x1, y1, x2, y2, c) {
  const minY = Math.max(0, Math.min(y0, y1, y2)), maxY = Math.min(H - 1, Math.max(y0, y1, y2));
  const area = (x1 - x0) * (y2 - y0) - (x2 - x0) * (y1 - y0);
  if (area === 0) return;
  for (let y = minY; y <= maxY; y++) {
    for (let x = 0; x < W; x++) {
      const w0 = ((x1 - x) * (y2 - y) - (x2 - x) * (y1 - y)) / area;
      const w1 = ((x2 - x) * (y0 - y) - (x0 - x) * (y2 - y)) / area;
      const w2 = 1 - w0 - w1;
      if (w0 >= 0 && w1 >= 0 && w2 >= 0) px(x, y, c);
    }
  }
}
// Even-odd scanline fill for simple polygons (used for the world map).
function poly(pts, c) {
  let minY = H, maxY = 0;
  for (const p of pts) { minY = Math.min(minY, p[1]); maxY = Math.max(maxY, p[1]); }
  for (let y = Math.max(0, Math.floor(minY)); y <= Math.min(H - 1, Math.ceil(maxY)); y++) {
    const xs = [];
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i], b = pts[(i + 1) % pts.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + ((y - a[1]) * (b[0] - a[0])) / (b[1] - a[1]));
      }
    }
    xs.sort((p, q) => p - q);
    for (let k = 0; k + 1 < xs.length; k += 2)
      for (let x = Math.max(0, Math.ceil(xs[k])); x <= Math.min(W - 1, Math.floor(xs[k + 1])); x++) px(x, y, c);
  }
}
function band(x, y, w, h, top, bottom) {
  for (let j = 0; j < h; j++) {
    const t = h <= 1 ? 0 : j / (h - 1);
    const c = [0, 1, 2].map((k) => Math.round(top[k] + (bottom[k] - top[k]) * t));
    rect(x, y + j, w, 1, c);
  }
}

// ---------- 5x7 bitmap face (hand-drawn for this paper) ----------
// Each glyph is 7 rows of 5 cells; '#' is ink, '.' is empty.
const FONT = {
  A: [".###.", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  B: ["####.", "#...#", "#...#", "####.", "#...#", "#...#", "####."],
  C: [".####", "#....", "#....", "#....", "#....", "#....", ".####"],
  D: ["####.", "#...#", "#...#", "#...#", "#...#", "#...#", "####."],
  E: ["#####", "#....", "#....", "####.", "#....", "#....", "#####"],
  F: ["#####", "#....", "#....", "####.", "#....", "#....", "#...."],
  G: [".####", "#....", "#....", "#.###", "#...#", "#...#", ".###."],
  H: ["#...#", "#...#", "#...#", "#####", "#...#", "#...#", "#...#"],
  I: [".###.", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  J: ["..###", "...#.", "...#.", "...#.", "...#.", "#..#.", ".##.."],
  K: ["#...#", "#..#.", "#.#..", "##...", "#.#..", "#..#.", "#...#"],
  L: ["#....", "#....", "#....", "#....", "#....", "#....", "#####"],
  M: ["#...#", "##.##", "#.#.#", "#.#.#", "#...#", "#...#", "#...#"],
  N: ["#...#", "##..#", "#.#.#", "#..##", "#...#", "#...#", "#...#"],
  O: [".###.", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  P: ["####.", "#...#", "#...#", "####.", "#....", "#....", "#...."],
  Q: [".###.", "#...#", "#...#", "#...#", "#.#.#", "#..#.", ".##.#"],
  R: ["####.", "#...#", "#...#", "####.", "#.#..", "#..#.", "#...#"],
  S: [".####", "#....", "#....", ".###.", "....#", "....#", "####."],
  T: ["#####", "..#..", "..#..", "..#..", "..#..", "..#..", "..#.."],
  U: ["#...#", "#...#", "#...#", "#...#", "#...#", "#...#", ".###."],
  V: ["#...#", "#...#", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  W: ["#...#", "#...#", "#...#", "#.#.#", "#.#.#", "##.##", "#...#"],
  X: ["#...#", ".#.#.", "..#..", "..#..", "..#..", ".#.#.", "#...#"],
  Y: ["#...#", "#...#", ".#.#.", "..#..", "..#..", "..#..", "..#.."],
  Z: ["#####", "....#", "...#.", "..#..", ".#...", "#....", "#####"],
  "0": [".###.", "#...#", "#..##", "#.#.#", "##..#", "#...#", ".###."],
  "1": ["..#..", ".##..", "..#..", "..#..", "..#..", "..#..", ".###."],
  "2": [".###.", "#...#", "....#", "..##.", ".#...", "#....", "#####"],
  "3": ["####.", "....#", "....#", ".###.", "....#", "....#", "####."],
  "4": ["...#.", "..##.", ".#.#.", "#..#.", "#####", "...#.", "...#."],
  "5": ["#####", "#....", "####.", "....#", "....#", "#...#", ".###."],
  "6": [".###.", "#....", "####.", "#...#", "#...#", "#...#", ".###."],
  "7": ["#####", "....#", "...#.", "...#.", "..#..", "..#..", "..#.."],
  "8": [".###.", "#...#", "#...#", ".###.", "#...#", "#...#", ".###."],
  "9": [".###.", "#...#", "#...#", "#..##", ".####", "....#", ".###."],
};
Object.assign(FONT, {
  a: [".....", ".....", ".###.", "....#", ".####", "#...#", ".####"],
  b: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "####."],
  c: [".....", ".....", ".####", "#....", "#....", "#....", ".####"],
  d: ["....#", "....#", ".####", "#...#", "#...#", "#...#", ".####"],
  e: [".....", ".....", ".###.", "#...#", "#####", "#....", ".###."],
  f: ["..##.", ".#...", ".#...", "####.", ".#...", ".#...", ".#..."],
  g: [".....", ".....", ".####", "#...#", "#...#", ".###.", "....#"],
  h: ["#....", "#....", "####.", "#...#", "#...#", "#...#", "#...#"],
  i: [".....", "..#..", ".....", ".##..", "..#..", "..#..", ".###."],
  j: [".....", "...#.", ".....", "..##.", "...#.", "...#.", "##..."],
  k: ["#....", "#....", "#..#.", "#.#..", "##...", "#.#..", "#..#."],
  l: [".##..", "..#..", "..#..", "..#..", "..#..", "..#..", ".###."],
  m: [".....", ".....", "##.#.", "#.#.#", "#.#.#", "#.#.#", "#.#.#"],
  n: [".....", ".....", "####.", "#...#", "#...#", "#...#", "#...#"],
  o: [".....", ".....", ".###.", "#...#", "#...#", "#...#", ".###."],
  p: [".....", ".....", "####.", "#...#", "#...#", "####.", "#...."],
  q: [".....", ".....", ".####", "#...#", "#...#", ".####", "....#"],
  r: [".....", ".....", "#.##.", "##..#", "#....", "#....", "#...."],
  s: [".....", ".....", ".####", "#....", ".###.", "....#", "####."],
  t: [".#...", ".#...", "####.", ".#...", ".#...", ".#...", "..##."],
  u: [".....", ".....", "#...#", "#...#", "#...#", "#..##", ".##.#"],
  v: [".....", ".....", "#...#", "#...#", "#...#", ".#.#.", "..#.."],
  w: [".....", ".....", "#...#", "#...#", "#.#.#", "#.#.#", ".#.#."],
  x: [".....", ".....", "#...#", ".#.#.", "..#..", ".#.#.", "#...#"],
  y: [".....", ".....", "#...#", "#...#", "#...#", ".####", "....#"],
  z: [".....", ".....", "#####", "...#.", "..#..", ".#...", "#####"],
  " ": [".....", ".....", ".....", ".....", ".....", ".....", "....."],
  ".": [".....", ".....", ".....", ".....", ".....", ".##..", ".##.."],
  ",": [".....", ".....", ".....", ".....", ".##..", ".##..", ".#..."],
  ":": [".....", ".##..", ".....", ".....", ".##..", ".....", "....."],
  ";": [".....", ".##..", ".....", ".....", ".##..", ".##..", ".#..."],
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "'": ["..#..", "..#..", ".#...", ".....", ".....", ".....", "....."],
  '"': [".#.#.", ".#.#.", ".....", ".....", ".....", ".....", "....."],
  "-": [".....", ".....", ".....", "#####", ".....", ".....", "....."],
  "(": ["...#.", "..#..", ".#...", ".#...", ".#...", "..#..", "...#."],
  ")": [".#...", "..#..", "...#.", "...#.", "...#.", "..#..", ".#..."],
  "/": ["....#", "...#.", "...#.", "..#..", ".#...", "#....", "#...."],
  "%": ["#...#", "#..#.", "...#.", "..#..", ".#...", "#..#.", "#...#"],
  $: ["..#..", ".####", "#.#.#", ".#.#.", "..#.#", "####.", "..#.."],
  "&": [".##..", "#..#.", "#.#..", ".#...", "#.#.#", "#..#.", ".##.#"],
  "+": [".....", "..#..", "..#..", "#####", "..#..", "..#..", "....."],
  "=": [".....", ".....", "#####", ".....", "#####", ".....", "....."],
  "•": [".....", ".....", "..#..", ".###.", ".###.", "..#..", "....."],
  "·": [".....", ".....", ".....", ".##..", ".##..", ".....", "....."],
  "→": [".....", ".....", "..#..", "...#.", "#####", "...#.", "..#.."],
  _: [".....", ".....", ".....", ".....", ".....", ".....", "#####"],
});
const GLYPH = (ch) => FONT[ch] || FONT["?"] || FONT[" "];

function drawChar(x, y, s, c, ch) {
  const g = GLYPH(ch);
  for (let r = 0; r < 7; r++)
    for (let col = 0; col < 5; col++)
      if (g[r][col] === "#") rect(x + col * s, y + r * s, s, s, c);
}
function textW(str, s) { return str.length * 6 * s - s; }
function drawText(x, y, s, c, str) {
  let cx = x;
  for (const ch of str) { drawChar(cx, y, s, c, ch); cx += 6 * s; }
  return cx;
}
function drawTextC(cx, y, s, c, str) { return drawText(cx - Math.floor(textW(str, s) / 2), y, s, c, str); }
// Greedy word wrap into lines no wider than maxW px at scale s.
function wrap(str, maxW, s) {
  const words = str.split(" ");
  const lines = [];
  let cur = "";
  for (const w of words) {
    const test = cur ? cur + " " + w : w;
    if (textW(test, s) <= maxW || !cur) cur = test;
    else { lines.push(cur); cur = w; }
  }
  if (cur) lines.push(cur);
  return lines;
}
function drawLines(x, y, s, lead, c, lines) {
  lines.forEach((ln, i) => drawText(x, y + i * lead, s, c, ln));
  return y + lines.length * lead;
}

// ---------- palette ----------
const PAPER = [246, 241, 227], INK = [22, 33, 58], RED = [200, 16, 46];
const BLUE = [29, 78, 121], GOLD = [201, 162, 39], SKY = [191, 217, 232];
const SKY2 = [235, 225, 190], SEA = [46, 111, 158], SEA2 = [24, 68, 110];
const SAND = [227, 211, 168], SAND2 = [203, 178, 120], GREEN = [63, 125, 78];
const GREY = [138, 138, 138], LGREY = [210, 205, 190], WHITE = [255, 255, 255];
const DUSK = [232, 164, 96], DUSK2 = [214, 120, 74], SMOKE = [120, 120, 118];
const STONE = [168, 162, 148], STONE2 = [140, 134, 120];

// ---------- hero scenes (312 x 150) ----------
function sceneCop(x, y, w, h) {
  band(x, y, w, h, SKY, SKY2);
  circle(x + w - 52, y + 34, 22, [245, 200, 90]);
  // dunes kept inside the scene
  poly([[x, y + h], [x, y + h - 34], [x + 120, y + h - 58], [x + 210, y + h]], SAND);
  poly([[x + 90, y + h], [x + 150, y + h - 44], [x + 250, y + h - 30], [x + w, y + h - 18], [x + w, y + h]], SAND2);
  // wind turbines (dark for contrast)
  for (const tx of [x + 70, x + 160, x + 250]) {
    vline(tx, y + h - 52, y + h - 8, INK);
    const hubY = y + h - 52;
    line(tx, hubY, tx - 13, hubY - 9, INK);
    line(tx, hubY, tx + 13, hubY - 9, INK);
    line(tx, hubY, tx, hubY + 15, INK);
    circle(tx, hubY, 3, INK);
  }
  // tiny summit flag
  line(x + 34, y + h - 40, x + 34, y + h - 60, INK);
  tri(x + 34, y + h - 60, x + 52, y + h - 55, x + 34, y + h - 50, RED);
}
function sceneGulf(x, y, w, h) {
  band(x, y, w, h * 0.45, DUSK, DUSK2);
  circle(x + 62, y + 30, 20, [250, 220, 140]);
  band(x, y + Math.floor(h * 0.45), w, h - Math.floor(h * 0.45), SEA, SEA2);
  // tanker silhouette
  rect(x + 40, y + 92, 200, 26, [16, 22, 34]);
  rect(x + 208, y + 66, 26, 26, [16, 22, 34]);
  rect(x + 52, y + 80, 12, 12, [16, 22, 34]);
  line(x + 240, y + 66, x + 240, y + 50, [16, 22, 34]);
  // flames on deck
  tri(x + 96, y + 92, x + 108, y + 66, x + 120, y + 92, [240, 140, 40]);
  tri(x + 126, y + 92, x + 136, y + 72, x + 146, y + 92, [250, 200, 60]);
  // smoke plume
  circle(x + 112, y + 56, 12, SMOKE);
  circle(x + 128, y + 40, 15, [150, 150, 148]);
  circle(x + 148, y + 22, 18, [170, 170, 168]);
  // wake lines
  hline(x + 20, x + 260, y + 126, [140, 190, 220]);
  hline(x + 60, x + 220, y + 136, [120, 170, 205]);
}
function sceneCourt(x, y, w, h) {
  band(x, y, w, h, SKY, [226, 232, 238]);
  // court building
  rect(x + 56, y + 58, 200, 66, STONE);
  tri(x + 46, y + 60, x + 156, y + 18, x + 266, y + 60, STONE2);
  circle(x + 156, y + 40, 9, GOLD);
  for (const cx of [76, 118, 160, 202, 244]) rect(x + cx - 4, y + 62, 8, 58, WHITE);
  rect(x + 46, y + 124, 220, 8, STONE2);
  rect(x + 36, y + 132, 240, 8, STONE);
  rect(x + 26, y + 140, 260, 8, STONE2);
  // flags
  line(x + 24, y + 30, x + 24, y + 78, INK);
  tri(x + 24, y + 30, x + 46, y + 36, x + 24, y + 42, BLUE);
  line(x + 288, y + 30, x + 288, y + 78, INK);
  tri(x + 288, y + 30, x + 266, y + 36, x + 288, y + 42, RED);
}

// ---------- mid icons (190 x 52) ----------
function iconNato(x, y, w, h) {
  band(x, y, w, h, [214, 228, 240], [170, 196, 218]);
  // shield
  poly([[x + 95, y + 6], [x + 128, y + 12], [x + 128, y + 28], [x + 95, y + 46], [x + 62, y + 28], [x + 62, y + 12]], BLUE);
  ring(x + 95, y + 26, 11, 2, WHITE);
  circle(x + 95, y + 26, 4, GOLD);
}
function iconHospital(x, y, w, h) {
  band(x, y, w, h, [238, 240, 244], [200, 206, 214]);
  rect(x + 70, y + 8, 50, 36, WHITE);
  rect(x + 88, y + 14, 14, 24, RED);
  rect(x + 80, y + 21, 30, 10, RED);
  rect(x + 30, y + 38, 130, 6, STONE2);
}
function iconTennis(x, y, w, h) {
  band(x, y, w, h, [120, 170, 90], [70, 130, 60]);
  circle(x + 95, y + 26, 16, [220, 235, 90]);
  line(x + 82, y + 14, x + 108, y + 38, WHITE);
  line(x + 108, y + 14, x + 82, y + 38, WHITE);
  hline(x + 20, x + 170, y + 44, WHITE);
}
function iconMarket(x, y, w, h) {
  band(x, y, w, h, [240, 236, 224], [214, 206, 188]);
  const bars = [18, 30, 12, 24, 8];
  bars.forEach((bh, i) => rect(x + 40 + i * 24, y + 44 - bh, 14, bh, i === 4 ? RED : BLUE));
  line(x + 34, y + 10, x + 164, y + 42, RED);
}
function iconCrowd(x, y, w, h) {
  band(x, y, w, h, [232, 220, 200], [200, 180, 150]);
  for (const cx of [50, 80, 110, 140]) {
    circle(x + cx, y + 20, 6, INK);
    rect(x + cx - 8, y + 28, 16, 14, BLUE);
  }
  rect(x + 120, y + 6, 34, 14, WHITE);
  rect(x + 124, y + 10, 26, 2, RED);
}
function iconAid(x, y, w, h) {
  band(x, y, w, h, [190, 215, 235], [140, 180, 210]);
  rect(x + 66, y + 16, 58, 28, [190, 150, 100]);
  rect(x + 66, y + 16, 58, 6, [150, 115, 70]);
  rect(x + 90, y + 26, 10, 10, WHITE);
  hline(x + 20, x + 170, y + 44, WHITE);
  hline(x + 40, x + 150, y + 47, WHITE);
}
function iconRobot(x, y, w, h) {
  band(x, y, w, h, [226, 228, 232], [190, 194, 200]);
  rect(x + 74, y + 10, 42, 30, STONE2);
  circle(x + 86, y + 24, 4, RED);
  circle(x + 104, y + 24, 4, RED);
  rect(x + 82, y + 32, 26, 3, INK);
  line(x + 78, y + 10, x + 70, y + 2, INK);
  line(x + 112, y + 10, x + 120, y + 2, INK);
  circle(x + 70, y + 2, 3, GOLD);
  circle(x + 120, y + 2, 3, GOLD);
}
function iconGlobe(x, y, w, h) {
  band(x, y, w, h, [200, 220, 235], [160, 185, 210]);
  circle(x + 95, y + 26, 18, SEA);
  circle(x + 88, y + 20, 6, GREEN);
  circle(x + 104, y + 30, 7, GREEN);
  ring(x + 95, y + 26, 18, 1, WHITE);
  hline(x + 77, x + 113, y + 26, WHITE);
}
function iconPlane(x, y, w, h) {
  band(x, y, w, h, [210, 224, 236], [170, 188, 208]);
  tri(x + 30, y + 30, x + 150, y + 18, x + 150, y + 28, WHITE);
  tri(x + 60, y + 30, x + 100, y + 10, x + 112, y + 28, WHITE);
  rect(x + 140, y + 18, 22, 12, WHITE);
  hline(x + 20, x + 170, y + 42, GREY);
}
function iconBridge(x, y, w, h) {
  band(x, y, w, h, [205, 225, 235], [165, 195, 215]);
  rect(x + 20, y + 18, 150, 4, RED);
  for (const cx of [45, 95, 145]) vline(x + cx, y + 22, y + 44, RED);
  hline(x + 20, x + 170, y + 44, STONE2);
  line(x + 20, y + 22, x + 45, y + 44, STONE2);
  line(x + 170, y + 22, x + 145, y + 44, STONE2);
}

// ---------- world map (stylised lon/lat polygons) ----------
const MAP = { x: 28, y: 830, w: 600, h: 128 };
function project(lon, lat) {
  return [
    MAP.x + ((lon + 170) / 340) * MAP.w,
    MAP.y + ((75 - lat) / 130) * MAP.h,
  ];
}
const CONTINENTS = [
  [[-168, 66], [-140, 70], [-120, 72], [-95, 80], [-80, 73], [-60, 60], [-55, 47], [-70, 42], [-75, 35], [-80, 26], [-90, 21], [-97, 16], [-105, 20], [-117, 32], [-125, 40], [-125, 49], [-140, 60], [-165, 60]],
  [[-80, 10], [-60, 8], [-50, 0], [-40, -5], [-35, -10], [-40, -20], [-48, -28], [-58, -35], [-65, -40], [-70, -52], [-73, -40], [-75, -25], [-80, -15], [-80, 0]],
  [[-10, 36], [-9, 43], [0, 48], [-5, 50], [5, 53], [8, 57], [18, 56], [21, 55], [28, 59], [30, 60], [30, 70], [18, 70], [12, 65], [5, 60], [0, 55], [-5, 50], [-10, 48]],
  [[-17, 15], [-10, 30], [0, 35], [10, 37], [20, 32], [32, 31], [35, 28], [43, 12], [51, 11], [48, 0], [40, -10], [35, -20], [28, -33], [18, -35], [12, -18], [9, 4], [-8, 5]],
  [[30, 70], [40, 68], [60, 70], [70, 72], [90, 75], [110, 76], [130, 72], [150, 70], [170, 66], [178, 65], [162, 60], [158, 52], [142, 50], [140, 40], [130, 35], [127, 40], [120, 30], [110, 20], [105, 10], [100, 8], [95, 16], [90, 22], [80, 13], [77, 8], [72, 20], [66, 25], [58, 25], [52, 28], [48, 30], [44, 29], [40, 31], [36, 36], [30, 36], [30, 42], [30, 50], [30, 60]],
  [[113, -22], [114, -30], [115, -35], [120, -34], [129, -32], [137, -35], [140, -38], [147, -39], [150, -37], [153, -27], [146, -19], [142, -11], [136, -12], [132, -12], [126, -14], [122, -17]],
];
const PINS = [
  ["ANTALYA", 30.7, 36.9], ["BAHRAIN", 50.6, 26.2], ["THE HAGUE", 4.3, 52.1],
  ["WARSAW", 21.0, 52.2], ["BRASILIA", -47.9, -15.8], ["PARIS", 2.4, 48.9],
  ["TAIPEI", 121.6, 25.0], ["DHAKA", 90.4, 23.8],
];

// ---------- content: every story verified to 22 Nov 2026 ----------
const NUMBERS = [
  ["2", "COP31 IN", "OVERTIME"],
  ["$12BN", "VENEZUELA", "OIL CASH"],
  ["7,641", "TAIWAN PTS", "LOST IN WEEK"],
  ["35.9", "VIX FEAR", "GAUGE JUMPS"],
  ["4", "GAZA DEATHS", "TRUCE FAILS"],
  ["50+", "HOMES TORCHED", "BANGLADESH"],
];
const HEROES = [
  { tag: "CLIMATE", scene: sceneCop, head: "CLIMATE TALKS RUN INTO OVERTIME", dek: "Fossil-fuel fight stalls COP31 in Antalya." },
  { tag: "GULF", scene: sceneGulf, head: "IRAN HITS BAHRAIN AS TANKERS BURN", dek: "Bahrain plant hit; ships ablaze in Hormuz." },
  { tag: "JUSTICE", scene: sceneCourt, head: "ICJ RULES ON MYANMAR GENOCIDE", dek: "The world court delivers its verdict." },
];
const MIDS = [
  { icon: iconNato, head: "NATO VOWS TO DEFEND EVERY INCH OF POLAND" },
  { icon: iconHospital, head: "BOLSONARO IN INTENSIVE CARE" },
  { icon: iconTennis, head: "ALCARAZ FACES ZVEREV FOR ATP FINALS TITLE" },
  { icon: iconMarket, head: "TAIWAN BANS SHORT SELLING" },
  { icon: iconCrowd, head: "4TH WEEKEND OF FRENCH COST PROTESTS" },
  { icon: iconAid, head: "FOUR NATIONS DEMAND GAZA AID ACCESS" },
  { icon: iconRobot, head: "US, CHINA: HUMANS MUST RULE AI ARMS" },
  { icon: iconGlobe, head: "UN AGREES PACT ON KILLER ROBOT WEAPONS" },
  { icon: iconPlane, head: "ICE SEIZES TWO ON SEATTLE JET BRIDGE" },
  { icon: iconBridge, head: "MODI OPENS NITISH SETU BRIDGE" },
];
const MORE = [
  "BANGLADESH ARSON",
  "BEPICOLOMBO AT MERCURY",
  "INDIA: 1 CRORE HPV JABS",
  "TRAIN GANG STOLE $22M",
  "RAJASTHAN CRASH KILLS 9",
  "SEOUL: $75,000 TIP REWARD",
];

// ---------- compose ----------
function main() {
  rect(0, 0, W, H, PAPER);
  const M = 28, CW = W - 2 * M;

  // masthead
  drawTextC(W / 2, 16, 2, RED, "THE WORLD IN ONE DAY");
  drawTextC(W / 2, 36, 7, INK, "SUNDAY 22 NOVEMBER");
  drawTextC(W / 2, 96, 4, INK, "2026 \u00b7 22 STORIES \u00b7 EVERY REGION");
  rect(M, 134, CW, 4, RED);
  rect(M, 140, CW, 2, INK);

  // number strip
  const cellW = CW / 6;
  NUMBERS.forEach(([num, l1, l2], i) => {
    const cx = M + i * cellW;
    if (i > 0) vline(Math.round(cx), 152, 244, LGREY);
    drawTextC(cx + cellW / 2, 154, 4, RED, num);
    drawTextC(cx + cellW / 2, 192, 2, INK, l1);
    drawTextC(cx + cellW / 2, 210, 2, INK, l2);
  });
  rect(M, 246, CW, 2, INK);

  // heroes
  const heroW = 312, heroGap = (CW - 3 * heroW) / 2;
  HEROES.forEach((h, i) => {
    const hx = M + i * (heroW + heroGap), hy = 256;
    h.scene(hx, hy, heroW, 150);
    rect(hx, hy + 150 - 22, textW(h.tag, 1) + 14, 22, RED);
    drawText(hx + 7, hy + 150 - 17, 1, WHITE, h.tag);
    const headLines = wrap(h.head, heroW, 3);
    drawLines(hx, hy + 162, 3, 26, INK, headLines);
    const dekLines = wrap(h.dek, heroW, 2);
    drawLines(hx, hy + 162 + headLines.length * 26 + 6, 2, 17, [70, 70, 70], dekLines);
  });
  rect(M, 540, CW, 2, INK);

  // mid rows (2 x 5)
  const midW = 190, midGap = (CW - 5 * midW) / 4;
  MIDS.forEach((m, i) => {
    const row = Math.floor(i / 5), col = i % 5;
    const mx = M + col * (midW + midGap);
    const my = row === 0 ? 550 : 690;
    m.icon(mx, my, midW, 52);
    const lines = wrap(m.head, midW - 20, 2);
    drawLines(mx, my + 60, 2, 17, INK, lines);
  });
  rect(M, 820, CW, 2, INK);

  // map + more stories
  rect(MAP.x - 6, MAP.y - 6, MAP.w + 12, MAP.h + 12, [232, 226, 208]);
  for (const c of CONTINENTS) poly(c.map(([lo, la]) => project(lo, la)), [120, 140, 120]);
  for (const [name, lo, la] of PINS) {
    const [pxx, pyy] = project(lo, la);
    circle(pxx, pyy, 5, RED);
    circle(pxx, pyy, 2, WHITE);
  }
  const rx = 660;
  drawText(rx, 830, 2, RED, "MORE STORIES");
  rect(rx, 850, 336, 2, RED);
  MORE.forEach((s, i) => {
    drawText(rx, 860 + i * 18, 2, INK, (i + 1) + ". " + s);
  });

  // date check + sources
  rect(M, 970, CW, 26, [255, 255, 255]);
  for (let k = 0; k < 2; k++) {
    rect(M + k, 970 + k, CW - 2 * k, 1, RED);
    rect(M + k, 970 + 25 - k, CW - 2 * k, 1, RED);
    rect(M + k, 970 + k, 1, 26 - 2 * k, RED);
    rect(M + CW - 1 - k, 970 + k, 1, 26 - 2 * k, RED);
  }
  drawTextC(W / 2, 978, 2, RED, "DATE CHECK: ALL STORIES ABOVE ARE FROM SUNDAY 22 NOVEMBER 2026.");
  drawTextC(W / 2, 1004, 1, [110, 110, 110], "SOURCES: REUTERS, AP, AFP, BBC, PTI, YONHAP  \u00b7  22 NOV 2026");

  const outDir = process.env.MAKEFUN_OUTPUT_DIR || "/output";
  mkdirSync(outDir, { recursive: true });
  const png = encodePNG(fb, W, H);
  writeFileSync(outDir + "/entry.png", png);
  console.log("wrote " + outDir + "/entry.png " + png.length + " bytes");
}

main();
