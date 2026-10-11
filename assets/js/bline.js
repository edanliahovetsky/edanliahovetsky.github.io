// BLine chapter. Most of it is normal page flow; this file drives:
//   - the ONE pinned sequence on the page: the real BLine 2027 editor (captured frame by frame by
//     scripts/capture/takes.mjs), scrubbed by scroll through Press play, Generate, Organize and Learn, on tilted
//     screens with a panel lifted out beside them at full 4K sharpness (the launch film's framing);
//   - the team montage's labels (from the clip's currentTime);
//   - the banner wall dropping in once, with the film's bounce, when it scrolls into view;
//   - restarting the Rocket City autonomous clip from 0:20 each time it comes into view.
import { clamp, lerp, smooth, easeOut, win, keyframes, Timeline, pinScene } from "./scroll-scene.js";

const $ = (id) => document.getElementById(id);
const root = $("bline-scene");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ================================================================== the pinned editor sequence
const TL = new Timeline([["play", 1.3], ["generate", 2.3], ["organize", 2.0], ["learn", 2.4]]);
const UNIT_VH = 42;
const TILT = 0.6; // the film's camera angles, softened

// ================================================================== editor takes (real UI frames)
let manifest = null, meta = null;
const tier = () => (Math.min(window.innerWidth, 1800) * Math.min(2, window.devicePixelRatio || 1) > 1400 ? "hd" : "sd");
class Take {
  constructor(name) { this.name = name; this.imgs = []; this.ready = []; }
  init() {
    const m = manifest[this.name];
    this.count = m.count; this.step = m.step; this.first = m.first || 0;
    this.tier = (m.tiers || ["hd", "sd"]).includes(tier()) ? tier() : "hd";
    this.meta = meta[this.name.split("-")[0]];
    return this;
  }
  src(i) { return `assets/seq/${this.name}/${this.tier}/${String(i + 1).padStart(4, "0")}.webp`; }
  request(i, onload) {
    if (this.imgs[i]) return;
    const img = new Image();
    img.alt = "";
    img.src = this.src(i);
    this.imgs[i] = img;
    // Decode off the main thread before the frame is ever drawn (drawing an undecoded image decodes it right
    // there, mid-scroll, which is what made scrubbing stutter).
    img.decode().catch(() => {}).then(() => { this.ready[i] = true; onload(); });
  }
  preload(onload) {
    if (this.preloaded) return;
    this.preloaded = true;
    for (const s of [8, 4, 2, 1]) for (let i = 0; i < this.count; i += s) this.request(i, onload);
  }
  /** The loaded frame at take-frame f (30 fps index), plus the next one and the blend toward it. */
  at(f) {
    const x = clamp((f - this.first) / this.step, 0, this.count - 1), i = Math.floor(x), k = x - i;
    const a = this.near(i), b = k > 0.02 && this.ready[i + 1] && a === this.imgs[i] ? this.imgs[i + 1] : null;
    return { a, b, k };
  }
  near(i) {
    for (let d = 0; d < this.count; d++) {
      if (this.ready[i - d]) return this.imgs[i - d];
      if (this.ready[i + d]) return this.imgs[i + d];
    }
    return null;
  }
  frames() { return this.meta.frames; }
  marker(name) { return this.meta.markers[name]; }
  cursor(f) {
    const c = this.meta.cursor, i = clamp(Math.floor(f), 0, c.length - 1), j = Math.min(c.length - 1, i + 1), k = clamp(f - i);
    return { x: lerp(c[i][0], c[j][0], k), y: lerp(c[i][1], c[j][1], k), down: c[i][2], visible: c[i][3] };
  }
  /** Recorded page position of the simulated robot (null before it appears). */
  probe(f) {
    const p = this.meta.probe;
    if (!p) return null;
    for (let d = 0; d < 30; d++) { const v = p[clamp(Math.round(f) - d, 0, p.length - 1)]; if (v) return { x: v[0], y: v[1] }; }
    return null;
  }
}
const TAKES = ["play", "generate", "generate-constraints", "organize", "organize-navigator", "learn", "learn-lessons", "learn-coach"];
const takes = {};

/**
 * Shows the 1920x1080 page (or a region of it) through a camera {x, y, zoom}, built from plain DOM so scrolling
 * costs almost nothing: each frame is an already-decoded <img> (the GPU keeps it), the camera is a CSS transform,
 * the cross-fade between neighbouring frames is opacity, and the cursor is a moved element. (Redrawing a canvas
 * on every scroll frame meant re-uploading a 2048-px texture each time, which is what made this section lag.)
 */
const CURSOR_SVG = '<svg viewBox="0 0 13 20" aria-hidden="true"><path d="M0 0v17l4.2-3.8L7 19.4l2.6-1.1-2.8-6.1h5.4z" fill="#fff" stroke="#0b0f14" stroke-width="1.3" stroke-linejoin="round"/></svg>';
class Screen {
  constructor(el) {
    this.el = el;
    el.innerHTML = '<div class="bl-view"></div><div class="bl-cursor">' + CURSOR_SVG + '</div><div class="bl-dim"></div>';
    this.view = el.querySelector(".bl-view"); this.cur = el.querySelector(".bl-cursor"); this.dim = el.querySelector(".bl-dim");
    this.a = this.b = null; this.key = "";
  }
  fit() { this.W = this.el.offsetWidth; this.H = this.el.offsetHeight; this.key = ""; }
  /**
   * Frames the region "cover"-style: the region fills the element whatever its shape (16:9 on desktop, taller on
   * portrait phones), cropping the sides rather than letterboxing, and cam.zoom zooms in from there.
   */
  draw(take, f, cam, region = [0, 0, 1920, 1080], cursor = true) {
    if (!take || !take.count || !this.W) return;
    const [rx, ry, rw, rh] = region, z = cam.zoom || 1;
    const b0 = this.W / rw, s = Math.max(this.W / rw, this.H / rh) * z; // base scale (view laid out at width W), shown scale
    const vw = this.W / s, vh = this.H / s;
    const cx = clamp(cam.x ?? rx + rw / 2, rx + vw / 2, rx + rw - vw / 2), cy = clamp(cam.y ?? ry + rh / 2, ry + vh / 2, ry + rh - vh / 2);
    const sx0 = cx - vw / 2, sy0 = cy - vh / 2;
    const { a, b, k } = take.at(f);
    if (a !== this.a || b !== this.b) {
      this.view.replaceChildren(...[a, b].filter(Boolean));
      this.a = a; this.b = b;
      if (a) a.style.opacity = 1;
    }
    if (b) b.style.opacity = k.toFixed(3);
    const key = [cx | 0, cy | 0, s.toFixed(4), this.W, this.H];
    if (key.join() !== this.key) {
      this.key = key.join();
      // The view is the whole region laid out at width W (its own aspect), then scaled and shifted on the GPU.
      this.view.style.width = rw * b0 + "px"; this.view.style.height = rh * b0 + "px";
      this.view.style.transform = `scale(${s / b0}) translate(${-(sx0 - rx) * b0}px, ${-(sy0 - ry) * b0}px)`;
    }
    const c = cursor ? take.cursor(f) : null;
    if (!c || !c.visible) { this.cur.style.opacity = 0; return; }
    const cs = (s * 1.25) / Math.sqrt(z);
    this.cur.style.opacity = 1;
    this.cur.style.transform = `translate(${(c.x - sx0) * s}px, ${(c.y - sy0) * s}px) scale(${cs * (c.down ? 0.9 : 1)})`;
  }
}

const screen = new Screen($("bl-screen"));
const panel = new Screen($("bl-panel"));
const word = $("bl-word"), wordMain = word.querySelector("span"), wordSub = word.querySelector("small");

function setWord(text, sub, a, pos = "") {
  if (wordMain.textContent !== text) wordMain.textContent = text;
  if (wordSub.textContent !== (sub || "")) wordSub.textContent = sub || "";
  if (word.dataset.pos !== pos) word.dataset.pos = pos;
  word.style.opacity = a;
  word.style.translate = `0 ${(1 - a) * 24}px`;
}
/** 3D framing of a screen/panel element (the film's CameraView "card"), kept to gentle angles. */
function frame3d(el, v, visible) {
  el.style.opacity = visible;
  el.style.visibility = visible > 0.005 ? "visible" : "hidden";
  if (visible <= 0.005) return;
  el.style.transform = `translate(-50%, -50%) translate(${v.tx || 0}vw, ${v.ty || 0}vh) perspective(2400px) rotateX(${(v.rx || 0) * TILT}deg) rotateY(${(v.ry || 0) * TILT}deg) rotateZ(${(v.rz || 0) * TILT}deg) scale(${v.s || 1})`;
  const dim = el.querySelector(".bl-dim");
  if (dim) dim.style.opacity = v.dim || 0;
}

// Frames load per beat: the beat on screen and the next one (not all ~350 at once).
const BEAT_TAKES = [["play"], ["generate", "generate-constraints"], ["organize", "organize-navigator"], ["learn", "learn-lessons", "learn-coach"]];
const BEATS = ["play", "generate", "organize", "learn"];
function loadAround(i) {
  for (const k of [i, i + 1]) for (const n of BEAT_TAKES[k] || []) takes[n].preload(() => scene.draw());
}

function render(t) {
  const at = (n) => TL.at(t, n), inb = (n) => TL.in(t, n), T = (n) => takes[n];
  let word = ["", "", 0, ""], pnl = null;
  loadAround(Math.max(0, BEATS.findIndex((b) => inb(b))));
  // The screen is already there as the sequence scrolls into view (no blank stage before the pin starts).
  const scr = { a: 1 };
  if (inb("play")) {
    // Press play. — the one quick beat before the features: the robot runs the generated path.
    const p = at("play"), tk = T("play"), play = tk.marker("play"), f = lerp(play - 14, tk.frames() - 1, p);
    const r = tk.probe(f) || { x: 760, y: 560 };
    const follow = smooth(play, play + 12, f) * (1 - smooth(0.82, 1, p));
    const cam = { x: lerp(760, r.x, follow * 0.8), y: lerp(560, r.y, follow * 0.8), zoom: lerp(1.05, 1.5, follow) };
    Object.assign(scr, keyframes(p, [[0, { rx: 24, rz: -6, s: 0.88 }], [0.25, { rx: 6, rz: -1, s: 0.96 }], [1, { rx: 14, ry: 10, rz: -2, s: 0.9 }]]));
    sizeScreen(false);
    if (portrait()) scr.ty = topOf(window.innerHeight, screen.el, scr.s);
    screen.draw(tk, f, cam);
    word = ["Press play.", "Draw a path, and BLine simulates the robot driving it", win(p, 0.1, 0.15), "left"];
  } else if (inb("generate")) {
    // Generate. — tilted screen, the Constraints panel lifted out beside it at full size.
    const p = at("generate"), tk = T("generate"), f = lerp(0, tk.frames() - 1, clamp((p - 0.04) / 0.92));
    const reg = manifest.generate.panels.constraints, lift = easeOut(smooth(0.04, 0.2, p));
    setPanelRegion(reg);
    const L = sideBySide("right", 0.84, 0.95);
    Object.assign(scr, keyframes(p, [[0, { rx: 14, ry: 22, rz: -2, s: 0.8, dim: 0.25 }], [1, { rx: 10, ry: 14, rz: -1, s: 0.84, dim: 0.28 }]]), L.screen);
    // The background frames just the field; the Constraints panel only appears once, lifted out beside it.
    screen.draw(tk, f, { x: 790, y: 580, zoom: 1.22 });
    pnl = { a: lift * win(p, 0.04, 0.08), ...keyframes(p, [[0, { rx: 4, ry: -14, s: 0.9 }], [1, { rx: 2, ry: -10, s: 0.95 }]]), ...L.panel };
    pnl.ty += (1 - lift) * 8;
    panel.draw(T("generate-constraints"), f, { zoom: 1 }, reg, true);
    word = ["Generate.", "Every handoff radius and speed limit, solved together", win(p, 0.08, 0.1), "left"];
  } else if (inb("organize")) {
    // Organize. — the Project Navigator's web of groups and paths, lifted out; the field shows the chained paths.
    const p = at("organize"), tk = T("organize"), f = lerp(0, tk.frames() - 1, clamp((p - 0.03) / 0.94));
    const reg = manifest.organize.panels.navigator, lift = easeOut(smooth(0.03, 0.18, p));
    setPanelRegion(reg);
    const L = sideBySide("left", 0.84, 0.97);
    Object.assign(scr, keyframes(p, [[0, { rx: 12, ry: -20, rz: 1, s: 0.8, dim: 0.22 }], [1, { rx: 9, ry: -14, rz: 0, s: 0.84, dim: 0.25 }]]), L.screen);
    screen.draw(tk, f, { x: 1244, y: 560, zoom: 1.42 }); // the field only; the navigator is the lifted panel
    pnl = { a: lift * win(p, 0.03, 0.08), ...keyframes(p, [[0, { rx: 3, ry: 14, s: 0.92 }], [1, { rx: 2, ry: 10, s: 0.97 }]]), ...L.panel };
    pnl.ty += (1 - lift) * 8;
    panel.draw(T("organize-navigator"), f, { zoom: 1 }, reg, true);
    word = ["Organize.", "Path groups chain paths into full autos", win(p, 0.08, 0.1), "right"];
  } else if (inb("learn") || t >= TL.span.learn[1]) {
    // Learn. — the background is the guided lesson canvas (the robot crossing the "Bend" handoff), framed without
    // the small coach card; the lifted panel shows the lesson list first, then that coach card, so nothing appears twice.
    const p = at("learn"), tk = T("learn"), lesson = tk.marker("lesson");
    const f = lerp(lesson + 14, tk.frames() - 1, clamp((p - 0.02) / 0.95));
    const listF = lerp(tk.marker("list") - 4, lesson - 2, clamp((p - 0.02) / 0.3));
    const useCoach = p > 0.345, name = useCoach ? "coach" : "lessons", reg = manifest.learn.panels[name];
    const swap = useCoach ? smooth(0.36, 0.43, p) : 1 - smooth(0.28, 0.335, p);
    setPanelRegion(reg);
    const L = sideBySide("right", 0.84, 0.96, 1.6);
    Object.assign(scr, keyframes(p, [[0, { rx: 12, ry: 16, rz: -1, s: 0.82, dim: 0.15 }], [1, { rx: 8, ry: 12, rz: 0, s: 0.86, dim: 0.12 }]]), L.screen);
    screen.draw(tk, f, portrait() ? learnPortraitCam() : { x: 1125, y: 600, zoom: 1.25 });
    // Last beat: the panel and word stay up as the pin releases, so the stage never scrolls away half-empty.
    pnl = { a: swap * smooth(0, 0.03, p), ...keyframes(p, [[0, { rx: 4, ry: -14, s: 0.94 }], [1, { rx: 2, ry: -10, s: 0.98 }]]), ...L.panel };
    pnl.ty += (1 - swap) * 6;
    panel.draw(T("learn-" + name), useCoach ? f : listF, { zoom: 1, y: 0 }, reg, true); // y: 0 keeps a cropped list at its top
    word = ["Learn.", "13 interactive lessons, built into the editor", smooth(0, 0.08, p), "left"];
  }
  frame3d(screen.el, scr, scr.a);
  frame3d(panel.el, pnl || {}, pnl ? pnl.a : 0);
  setWord(...word);
}
/**
 * Places the tilted screen and the lifted panel side by side inside the stage, in pixels, so neither runs off
 * screen at any window size. On phones they stack: screen above, panel below.
 */
const portrait = () => window.innerWidth / window.innerHeight < 0.9;
const TOP = 72; // below the site header
/** Portrait: the space between the header and the word card, which the screen (and panel) share. */
function portraitRoom() { return Math.max(240, word.offsetTop - 18 - TOP); }
/** Portrait screens: the editor screen is a taller crop pinned near the top; with a panel it gives most of the room up. */
function sizeScreen(hasPanel, minAspect = 0) {
  const room = portraitRoom(), H = window.innerHeight;
  // With a panel, the screen takes what the panel (at full width) leaves, but at least about a third of the room.
  const left = (room - 14 - (gutterWidth() / Math.max(panelAspect, 0.7)) * 0.96) / 0.84;
  let h = hasPanel ? Math.min(Math.max(room * 0.36, left), H * 0.5) : Math.min(room / 0.96, H * 0.75);
  if (minAspect) h = Math.min(h, screen.el.offsetWidth / minAspect);
  h = !portrait() ? "" : Math.round(h) + "px";
  if (screen.el.style.height !== h) { screen.el.style.height = h; screen.fit(); }
}
function topOf(H, el, scale) { return ((TOP + (el.offsetHeight * scale) / 2 - H / 2) / H) * 100; }
function sideBySide(panelSide, screenScale, panelScale, screenMinAspect = 0) {
  sizeScreen(true, screenMinAspect);
  const W = window.innerWidth, H = window.innerHeight, sw = screen.el.offsetWidth, sh = screen.el.offsetHeight;
  if (portrait()) {
    // Screen near the top, the lifted panel under it filling the rest, the word card keeps the bottom.
    const room = portraitRoom(), ph = sizePanelPortrait((room - sh * screenScale - 14) / panelScale);
    const top = TOP + Math.max(0, room - sh * screenScale - 14 - ph * panelScale) / 2; // a short pair sits mid-room
    const mid = top + sh * screenScale + 14 + (ph * panelScale) / 2;
    return { screen: { tx: 0, ty: topOf(H, screen.el, screenScale) + ((top - TOP) / H) * 100 }, panel: { tx: 0, ty: ((mid - H / 2) / H) * 100 } };
  }
  sizePanelPortrait(0);
  const pw = panel.el.offsetWidth;
  const m = Math.max(24, W * 0.035), dir = panelSide === "right" ? 1 : -1;
  const pc = W / 2 - m - (pw * panelScale) / 2; // panel center, from the stage center, toward its side
  const sc = W / 2 - m - (sw * screenScale) / 2; // screen center, toward the other side
  return { screen: { tx: (-dir * Math.max(0, sc) / W) * 100, ty: 0 }, panel: { tx: ((dir * pc) / W) * 100, ty: 0 } };
}
/**
 * Portrait: the panel takes the full width it can within maxH. Very tall panels (the lesson list) are shown no
 * narrower than 0.7:1 and cropped from the top, so their text stays readable on a phone. 0 clears it (landscape).
 */
function sizePanelPortrait(maxH) {
  let w = "", h = "";
  if (maxH > 0) {
    const aspect = Math.max(panelAspect, 0.7), maxW = gutterWidth();
    const pw = Math.min(maxW, maxH * aspect);
    w = Math.round(pw) + "px"; h = Math.round(pw / aspect) + "px";
  }
  if (panel.el.style.width !== w || panel.el.style.height !== h) { panel.el.style.width = w; panel.el.style.height = h; panel.fit(); }
  return panel.el.offsetHeight;
}
/**
 * Portrait Learn: a wide strip that holds the "0.70 m handoff" label and the Bend circle whole, while leaving out the
 * coach card in the frame's top-left corner (that card is the lifted panel).
 */
function learnPortraitCam() {
  const [x, y, w, h] = [350, 291, 1040, 650], base = Math.max(screen.W / 1920, screen.H / 1080);
  return { x: x + w / 2, y: y + h / 2, zoom: Math.max(1, screen.W / base / w, screen.H / base / h) };
}
/** The page width inside the gutters. */
const gutterWidth = () => window.innerWidth - 2 * clamp(window.innerWidth * 0.04, 16, 48);
let panelKey = "", panelAspect = 1;
function setPanelRegion(reg) {
  const key = reg.join(",");
  if (key === panelKey) return;
  panelKey = key;
  panelAspect = reg[2] / reg[3];
  panel.el.style.setProperty("--aspect", panelAspect);
  // Panels are drawn ~1.6x their size on the page, capped to the stage height.
  panel.el.style.setProperty("--ph", Math.min(78, (reg[3] / 1080) * 100 * 1.6) + "svh");
  panel.fit();
}


let ready = false;
const loadData = Promise.all([fetch("assets/seq/manifest.json").then((r) => r.json()), fetch("assets/seq/takes.json").then((r) => r.json())])
  .then(([m, tk]) => {
    manifest = m; meta = tk;
    for (const n of TAKES) takes[n] = new Take(n).init();
    // The first frame doubles as the screen's backdrop, so it is never an empty box while frames download.
    screen.el.style.backgroundImage = `url(${takes.play.src(0)})`;
    ready = true;
  });
const scene = pinScene({
  el: root, stage: root.querySelector(".scene-stage"), total: TL.total, unitVh: UNIT_VH, scrub: 0.6,
  render: (t) => { if (ready) render(t); },
  onNear: () => loadData.then(() => { loadAround(0); scene.draw(); }),
  onResize: () => { screen.fit(); panel.fit(); },
});
loadData.then(() => scene.draw());

// ================================================================== team montage labels
const CUTS = [
  ["2638", "Rocket City Regional", "my team"], ["6989", "Ankara Regional", "Türkiye"],
  ["4522", "Johnson Division", "World Championship"], ["1792", "Johnson Division", "World Championship"],
  ["3476", "SoCal State Championship", "California"], ["4655", "North Star Regional", "Minnesota"],
  ["4915", "Milstein Division", "World Championship"], ["4915", "Einstein", "World Championship"],
];
const teams = $("bl-teams"), teamLabel = $("bl-team-label");
let cutShown = -1;
teams.addEventListener("timeupdate", () => {
  const k = clamp(Math.floor(teams.currentTime / 1.6), 0, CUTS.length - 1);
  if (k === cutShown) return;
  cutShown = k;
  teamLabel.innerHTML = `<b>Team ${CUTS[k][0]}</b><span>${CUTS[k][1]} · ${CUTS[k][2]}</span>`;
});

// ================================================================== banner wall
// 2026 blue banners won while running BLine (the launch film's bannerData.ts; each checked against the team's
// code history or own post). Laid out on the film's two rafters (9 above, 10 below); they drop in the film's order
// and timing (fast slams 4 frames apart, then the five heroes, 3476's three together), once, in real time.
const FAST = [
  ["238", "NE District UNH", "Winner"], ["449", "Bethesda", "Engineering Inspiration"], ["4362", "FIM District Troy", "Winner"],
  ["4451", "FSC District Richland", "Winner"], ["4655", "Minnesota North Star", "Winner"], ["6989", "Ankara Regional", "Impact Award"],
  ["1792", "Seven Rivers", "Winner"], ["1165", "Las Vegas Regional", "Winner"], ["4451", "FSC District Richland", "Engineering Inspiration"],
  ["2586", "Michigan State Champs · Consumers Div.", "Winner"], ["1710", "Greater Kansas City", "Impact Award"], ["6989", "Ankara Regional", "Winner"],
];
const HEROES = [
  [["2811", "Pacific Northwest District Championship", "Winner"]], [["4451", "South Carolina State Championship", "Winner"]],
  [["449", "Chesapeake District Championship", "Winner"]],
  [["3476", "LA District", "Winner"], ["3476", "Orange County District", "Winner"], ["3476", "SoCal State Championship", "Winner"]],
  [["4915", "Milstein Division", "Winner"]],
];
const SLOT = (row, col) => ({ row, col });
const HERO_SLOTS = [[SLOT(0, 1)], [SLOT(1, 8)], [SLOT(0, 7)], [SLOT(1, 3), SLOT(1, 4), SLOT(1, 5)], [SLOT(0, 4)]];
const taken = new Set(HERO_SLOTS.flat().map((s) => s.row + "," + s.col));
const FAST_SLOTS = [...Array.from({ length: 9 }, (_, c) => SLOT(0, c)), ...Array.from({ length: 10 }, (_, c) => SLOT(1, c))]
  .filter((s) => !taken.has(s.row + "," + s.col)).sort((a, b) => (a.col - (a.row ? 4.5 : 4)) - (b.col - (b.row ? 4.5 : 4)) || a.row - b.row);
const DROPS = [
  ...FAST.map((d, i) => ({ d, at: 4 * (i + 1), slot: FAST_SLOTS[i], heavy: false })),
  ...HEROES.flatMap((g, gi) => g.map((d, k) => ({ d, at: gi === 3 ? 120 + k * 8 : [48, 72, 96, 0, 152][gi] + 6, slot: HERO_SLOTS[gi][k], heavy: true }))),
].sort((a, b) => a.at - b.at);
const BH = 406;
/** Banner pose t film-frames after landing: the film's accelerating drop, hang-bounce and damped swing. */
function bannerPose(t, heavy) {
  const fall = 5;
  if (t < -fall) return null;
  const p = Math.min(1, (t + fall) / fall);
  const drop = t < 0 ? -BH * 1.6 * (1 - p * p) : 0;
  const settle = t >= 0 ? Math.exp(-t / 5) : 0;
  const bounce = t >= 0 ? -10 * Math.sin(t * 1.1) * settle : 0;
  const swing = t >= 0 ? (heavy ? 2.4 : 3.5) * Math.sin(t * 0.55 + 0.4) * Math.exp(-t / 14) : 0;
  const squash = t >= 0 ? 1 + 0.035 * Math.sin(t * 1.3) * settle : 1;
  return `translateY(${drop + bounce}px) rotate(${swing}deg) scaleY(${squash})`;
}
const wall = $("bl-wall"), wallCount = $("bl-wall-count");
for (const r of [0, 1]) { const rod = document.createElement("div"); rod.className = "bl-rafter r" + r; wall.appendChild(rod); }
for (const p of DROPS) {
  const [team, event, award] = p.d, ev = "2026 " + event;
  const el = document.createElement("div");
  el.className = "bnr" + (p.heavy ? " hero" : "");
  // Slots in percent of the wall: 10 columns, the top row offset by half a column (the film's rafters).
  el.style.left = ((p.slot.col + (p.slot.row ? 0 : 0.5)) * 10 + 0.8) + "%";
  el.style.top = (p.slot.row ? 53 : 0) + "%";
  el.innerHTML = `<div class="bnr-team">${team}</div><div class="bnr-award${award.length > 14 ? " long" : ""}">${award}</div><div class="bnr-event${ev.length > 30 ? " long" : ""}">${ev}</div>`;
  wall.appendChild(el);
  p.el = el;
}
let wallStart = null;
function wallFrame(now) {
  const f = (now - wallStart) / (1000 / 30); // film frames since the wall started
  let landed = 0, busy = false;
  for (const p of DROPS) {
    const t = f - p.at;
    const pose = bannerPose(t, p.heavy);
    p.el.style.visibility = pose ? "visible" : "hidden";
    if (pose) p.el.style.transform = pose;
    if (t >= 0) landed++;
    if (t < 60) busy = true;
  }
  wallCount.textContent = landed;
  if (busy) requestAnimationFrame(wallFrame);
}
if (reduceMotion || !("IntersectionObserver" in window)) {
  for (const p of DROPS) p.el.style.visibility = "visible";
} else {
  wallCount.textContent = "0";
  new IntersectionObserver((entries, io) => {
    if (!entries[0].isIntersecting) return;
    io.disconnect();
    wallStart = performance.now();
    requestAnimationFrame(wallFrame);
  }, { threshold: 0.45 }).observe(wall);
}

// ================================================================== Championship clip
// The outline on our robot is drawn into the video itself (scripts/champs-clip/). It starts from 0:20 on the match
// clock each time it comes into view, and loops (with a manual restart for browsers that stop at the end).
const champs = $("bl-alhu");
champs.addEventListener("ended", () => { champs.currentTime = 0; const pr = champs.play(); pr && pr.catch(() => {}); });
if ("IntersectionObserver" in window) {
  new IntersectionObserver((entries) => { if (entries[0].isIntersecting) { try { champs.currentTime = 0; } catch (e) { /* not loaded yet */ } } }, { threshold: 0.5 }).observe(champs);
}
