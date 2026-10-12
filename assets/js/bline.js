// BLine chapter. Most of it is normal page flow; this file drives:
//   - the ONE pinned sequence on the page: the real BLine 2027 editor (captured frame by frame by
//     scripts/capture/takes.mjs): scrolling picks the step (Simulate, Generate, Organize, Learn) and each plays in time, on tilted
//     screens with a panel lifted out beside them at full 4K sharpness (the launch film's framing);
//   - the team montage's labels (from the clip's currentTime);
//   - the banner wall dropping in once, with the film's bounce, when it scrolls into view;
//   - restarting the Rocket City autonomous clip from 0:20 each time it comes into view.
import { clamp, lerp, smooth, easeOut, keyframes, Timeline, pinScene } from "./scroll-scene.js";

const $ = (id) => document.getElementById(id);
const root = $("bline-scene");
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// ================================================================== the pinned editor sequence
const TL = new Timeline([["simulate", 1], ["generate", 1], ["organize", 1], ["learn", 1]]);
const UNIT_VH = 130; // each step gets an equal stretch of scroll, about 1.3 screens, so no step is easy to scroll past
const TILT = 0.6; // the film's camera angles, softened

// ================================================================== editor clips (real UI, 30 fps video)
// scripts/build-clips.py renders each step as a main clip plus clips of the panels it lifts out, all the same length
// so they play in lockstep from the main clip's clock. takes.json has each take's cursor path, markers and robot
// positions (30 fps, 1920x1080 page pixels); the page draws the cursor itself.
let clipsInfo = null, meta = null;
const tier = () => (window.Media && window.Media.tier) || "hd"; // sd phones, hd desktops, xl big high-res screens (reel.js)
class Take {
  constructor(name) { this.meta = meta[name]; }
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
const takes = {};
/**
 * A step's videos: main plus its panels, sized for the device. Each carries the URLs of its first- and last-frame
 * stills (shown while it loads, and in place of it where video can't play). Steps load one at a time, in order.
 */
const vids = {};
function stepVideos(step) {
  if (vids[step]) return vids[step];
  const v = {}, c = clipsInfo[step], t = tier();
  for (const name of ["main", ...Object.keys(c.panels)]) {
    const el = document.createElement("video");
    el.muted = true; el.playsInline = true; el.setAttribute("playsinline", ""); el.setAttribute("muted", "");
    el.disablePictureInPicture = true; el.preload = near ? "auto" : "none"; // the backdrop draws before anything loads
    const file = name === "main" ? `main-${t}` : t === "sd" ? `${name}-sd` : name;
    el.src = `assets/clips/${step}/${file}.mp4`;
    el.dataset.first = `assets/clips/${step}/${name}-first.webp`;
    el.dataset.last = `assets/clips/${step}/${name}-last.webp`;
    v[name] = el;
  }
  return (vids[step] = v);
}
const all = (v) => Object.values(v);
/** Ready to play through without stalling (or the network has nothing more to give it). */
const buffered = (el) => el.readyState >= 4 || (el.readyState >= 2 && el.networkState === 1);
/**
 * Keeps the step on screen loading first; once it has buffered, starts the next one (nudging it to buffer even on
 * iPhones, which otherwise only fetch a video when it plays). Steps more than one away are let go, so at most two
 * steps' videos (four or five decoders) exist at once.
 */
const warmed = new Set();
function loadAround(i) {
  for (const el of all(stepVideos(BEATS[i]))) if (el.preload !== "auto") el.preload = "auto";
  const next = BEATS[i + 1];
  if (next && all(vids[BEATS[i]]).every(buffered) && !warmed.has(next)) {
    warmed.add(next);
    for (const el of all(stepVideos(next))) { const pr = el.play(); pr && pr.then(() => { el.pause(); el.currentTime = 0; }, () => {}); }
  }
  for (const [k, step] of BEATS.entries()) if (vids[step] && (k < i - 1 || k > i + 1)) release(step);
}
function release(step) {
  for (const el of all(vids[step])) { el.pause(); el.removeAttribute("src"); el.load(); }
  delete vids[step]; warmed.delete(step);
}
/** Steps whose video couldn't play (iPhone Low Power Mode blocks it, or it never arrived): they show their result. */
const stuck = new Set();
/** Which still a screen shows for this video: "last" for a step that can't play, "first" until a frame arrives. */
function stillFor(video) {
  if (stuck.has(cur)) return "last";
  return video.readyState >= 2 ? null : "first";
}

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
    el.innerHTML = '<div class="bl-view"><img class="bl-still" alt=""></div><div class="bl-cursor">' + CURSOR_SVG + '</div><div class="bl-dim"></div>';
    this.view = el.querySelector(".bl-view"); this.cur = el.querySelector(".bl-cursor"); this.dim = el.querySelector(".bl-dim");
    this.still = el.querySelector(".bl-still");
    this.shown = null; this.key = "";
  }
  fit() { this.W = this.el.offsetWidth; this.H = this.el.offsetHeight; this.key = ""; }
  /**
   * Frames the region "cover"-style: the region fills the element whatever its shape (16:9 on desktop, taller on
   * portrait phones), cropping the sides rather than letterboxing, and cam.zoom zooms in from there.
   */
  draw(video, take, f, cam, region = [0, 0, 1920, 1080], cursor = true, bounds = null) {
    if (!video || !this.W) return;
    // A still stands in until the video has a frame to show, or for good where it can't play.
    const still = stillFor(video);
    if (still) { const url = video.dataset[still]; if (this.still.dataset.src !== url) { this.still.src = url; this.still.dataset.src = url; } }
    this.still.style.opacity = still ? 1 : 0;
    video.style.opacity = still ? 0 : 1;
    const [rx, ry, rw, rh] = region, z = cam.zoom || 1;
    const b0 = this.W / rw, s = Math.max(this.W / rw, this.H / rh) * z; // base scale (view laid out at width W), shown scale
    const vw = this.W / s, vh = this.H / s;
    let cx = clamp(cam.x ?? rx + rw / 2, rx + vw / 2, rx + rw - vw / 2), cy = clamp(cam.y ?? ry + rh / 2, ry + vh / 2, ry + rh - vh / 2);
    if (bounds) { const [bx, by, bw, bh] = bounds; cx = vw < bw ? clamp(cx, bx + vw / 2, bx + bw - vw / 2) : bx + bw / 2; cy = vh < bh ? clamp(cy, by + vh / 2, by + bh - vh / 2) : by + bh / 2; }
    const sx0 = cx - vw / 2, sy0 = cy - vh / 2;
    if (video !== this.shown) { this.view.replaceChildren(this.still, video); this.shown = video; }
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
  a *= fade;
  word.style.opacity = a;
  word.style.translate = `0 ${(1 - a) * 24}px`;
}
/** 3D framing of a screen/panel element (the film's CameraView "card"), kept to gentle angles. */
function frame3d(el, v, visible) {
  visible *= fade;
  el.style.opacity = visible;
  el.style.visibility = visible > 0.005 ? "visible" : "hidden";
  if (visible <= 0.005) return;
  el.style.transform = `translate(-50%, -50%) translate(${v.tx || 0}vw, ${v.ty || 0}vh) perspective(2400px) rotateX(${(v.rx || 0) * TILT}deg) rotateY(${(v.ry || 0) * TILT}deg) rotateZ(${(v.rz || 0) * TILT}deg) scale(${v.s || 1})`;
  const dim = el.querySelector(".bl-dim");
  if (dim) dim.style.opacity = v.dim || 0;
}

const BEATS = ["simulate", "generate", "organize", "learn"];

/** Draws step `step` at take frame f (the main clip's current frame). */
function render(step, f) {
  const c = clipsInfo[step], T = takes[c.take], V = stepVideos(step), n = T.frames(), p = clamp(f / (n - 1));
  const m = (k) => T.marker(k), sec = (x) => x * c.fps;
  let word = ["", "", 1, ""], pnl = null, stat = null, tryLink = false;
  const scr = { a: 1 };
  if (step === "simulate") {
    // Simulate. — the whole field while the route is sketched; then the camera follows the robot as it drives it,
    // easing back out as it finishes.
    const r = T.probe(f) || { x: 950, y: 560 };
    const follow = smooth(m("play"), m("play") + sec(1.3), f) * (1 - smooth(m("end") - sec(0.5), m("end") + sec(0.5), f));
    // Portrait shows a tall slice of the 16:9 frame: start on the left, where the route begins.
    const x0 = portrait() ? 650 : 960;
    const cam = { x: lerp(x0, r.x, follow * 0.8), y: lerp(540, r.y, follow * 0.8), zoom: lerp(1, 1.3, follow) };
    const FIELD = [58, 110, 1815, 911], region = [0, 0, 1920, 1080].map((v, i) => lerp(v, FIELD[i], follow));
    Object.assign(scr, keyframes(p, [[0, { rx: 10, ry: 0, rz: -2, s: 0.94 }], [1, { rx: 14, ry: 10, rz: -2, s: 0.9 }]]));
    sizeScreen(false);
    if (portrait()) scr.ty = topOf(window.innerHeight, screen.el, scr.s);
    screen.draw(V.main, T, f, cam, undefined, true, region);
    word = ["Simulate.", "Sketch a route. Watch the robot drive it.", 1, "left"];
  } else if (step === "generate") {
    // Generate. — the field, with the Constraints panel lifted out beside it at full size; the run time before and
    // after shows what the one click bought.
    const reg = c.panels.constraints, lift = easeOut(smooth(0, sec(0.5), f));
    setPanelRegion(reg);
    const L = sideBySide("right", 0.84, 0.95);
    Object.assign(scr, keyframes(p, [[0, { rx: 14, ry: 22, rz: -2, s: 0.8, dim: 0.25 }], [1, { rx: 10, ry: 14, rz: -1, s: 0.84, dim: 0.28 }]]), L.screen);
    scr.s *= L.fitK || 1;
    screen.draw(V.main, T, f, { x: 790, y: 563, zoom: 1.32 }); // the field only; the panel is the only copy of Constraints
    pnl = { a: lift, ...keyframes(p, [[0, { rx: 4, ry: -14, s: 0.9 }], [1, { rx: 2, ry: -10, s: 0.95 }]]), ...L.panel };
    pnl.ty += (1 - lift) * 8;
    panel.draw(V.constraints, T, f, { zoom: 1 }, reg, true);
    word = ["Generate.", "One click tunes every turn and speed. Faster, and still on the path.", 1, "left"];
    stat = { ...T.meta.times, k: smooth(m("end") - sec(0.15), m("end") + sec(0.35), f) };
  } else if (step === "organize") {
    // Organize. — the Project Navigator's web of groups and paths, lifted out; the field shows the focused group.
    const reg = c.panels.navigator, lift = easeOut(smooth(0, sec(0.5), f));
    setPanelRegion(reg);
    const L = sideBySide("left", 0.84, 0.97);
    Object.assign(scr, keyframes(p, [[0, { rx: 12, ry: -20, rz: 1, s: 0.8, dim: 0.22 }], [1, { rx: 9, ry: -14, rz: 0, s: 0.84, dim: 0.25 }]]), L.screen);
    scr.s *= L.fitK || 1;
    screen.draw(V.main, T, f, { x: 1244, y: 560, zoom: 1.42 }); // the field only; the navigator is the lifted panel
    pnl = { a: lift, ...keyframes(p, [[0, { rx: 3, ry: 14, s: 0.92 }], [1, { rx: 2, ry: 10, s: 0.97 }]]), ...L.panel };
    pnl.ty += (1 - lift) * 8;
    panel.draw(V.navigator, T, f, { zoom: 1 }, reg, true);
    word = ["Organize.", "Chain paths into a full 20-second routine.", 1, "right"];
  } else {
    // Learn. — the lesson list opens on the editor; once Path Tuning starts, the background frames the lesson canvas
    // (without the small coach card) and the coach card is lifted out, so nothing appears twice.
    const lesson = m("lesson"), into = smooth(lesson + sec(0.2), lesson + sec(0.9), f);
    const reg = c.panels.coach;
    setPanelRegion(reg);
    const L = sideBySide("right", 0.84, 0.96, 1.6);
    Object.assign(scr, keyframes(p, [[0, { rx: 12, ry: 16, rz: -1, s: 0.82, dim: 0.15 }], [1, { rx: 8, ry: 12, rz: 0, s: 0.86, dim: 0.12 }]]), L.screen);
    scr.s *= L.fitK || 1;
    const after = portrait() ? learnPortraitCam() : { x: 1140, y: 560, zoom: 1.27 };
    screen.draw(V.main, T, f, { x: lerp(960, after.x, into), y: lerp(540, after.y, into), zoom: lerp(1.4, after.zoom, into) });
    pnl = { a: into, ...keyframes(p, [[0, { rx: 4, ry: -14, s: 0.94 }], [1, { rx: 2, ry: -10, s: 0.98 }]]), ...L.panel };
    pnl.ty += (1 - into) * 6 - (portrait() ? 0 : 10);
    panel.draw(V.coach, T, f, { zoom: 1 }, reg, true);
    word = ["Learn.", "13 interactive lessons teach it inside the editor.", 1, portrait() ? "left" : "right"];
    tryLink = true;
  }
  // Entrance (before the pin): rise from below, tilted back, and fade up; the step bar follows.
  const e = easeOut(smooth(0.25, 1, entry));
  if (e < 1) {
    scr.s = (scr.s || 1) * lerp(0.86, 1, e);
    scr.rx = (scr.rx || 0) + (1 - e) * 34;
    scr.ty = (scr.ty || 0) + (1 - e) * 14;
    scr.a *= smooth(0.15, 0.7, entry);
  }
  // Exit (after the pin releases): the word and panel fade as the stage scrolls away, so nothing hangs half-cut.
  word[2] *= 1 - exit;
  if (pnl) pnl.a *= 1 - exit;
  stepsEl.style.opacity = smooth(0.7, 1, entry) * (1 - exit);
  frame3d(screen.el, scr, scr.a);
  frame3d(panel.el, pnl || {}, pnl ? pnl.a : 0);
  setWord(...word);
  setStat(stat);
  tryEl.hidden = !tryLink;
  setStep(step);
}
const statEl = $("bl-stat"), tryEl = $("bl-try");
let statKey = "";
/** Generate's run time: "4.88 s", then "4.88 s → 4.10 s" once the faster replay finishes. */
function setStat(st) {
  if (!st || st.before == null) { statEl.hidden = true; return; }
  statEl.hidden = false;
  const key = `${st.before}|${st.after}`;
  if (key !== statKey) {
    statKey = key;
    statEl.innerHTML = `<span class="lbl">Run time</span><span class="old">${st.before.toFixed(2)} s</span><span class="new">→ ${st.after.toFixed(2)} s</span>`;
  }
  statEl.querySelector(".new").style.opacity = st.k;
  statEl.classList.toggle("done", st.k > 0.5);
}
/**
 * Places the tilted screen and the lifted panel side by side inside the stage, in pixels, so neither runs off
 * screen at any window size; when the pair is narrower than the window (wide and ultrawide screens) it is centered
 * with a fixed gap instead of pushed to the edges. On phones they stack: screen above, panel below.
 */
const portrait = () => window.innerWidth / window.innerHeight < 0.9;
const TOP = 112; // below the site header and the step indicator
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
  const gap = clamp(W * 0.03, 24, 64), fitK = clamp((W - 2 * m - gap - pw * panelScale) / (sw * screenScale), 0.5, 1);
  screenScale *= fitK;
  const pair = sw * screenScale + gap + pw * panelScale, half = Math.min(pair, W - 2 * m) / 2;
  const pc = half - (pw * panelScale) / 2; // panel center, from the stage center, toward its side
  const sc = half - (sw * screenScale) / 2; // screen center, toward the other side
  return { screen: { tx: (-dir * Math.max(0, sc) / W) * 100, ty: 0 }, panel: { tx: ((dir * pc) / W) * 100, ty: 0 }, fitK };
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
const loadData = Promise.all([fetch("assets/clips/clips.json").then((r) => r.json()), fetch("assets/clips/takes.json").then((r) => r.json())])
  .then(([c, tk]) => {
    clipsInfo = c; meta = tk;
    for (const n of Object.keys(meta)) takes[n] = new Take(n);
    // The first frame doubles as the screen's backdrop, so it is never an empty box while the clip loads.
    screen.el.style.backgroundImage = "url(assets/clips/simulate/main-first.webp)";
    ready = true;
  });
// Step indicator: shows which step is on screen and jumps to a step when clicked.
const steps = [...document.querySelectorAll("#bl-steps button")];
let stepShown = "";
function setStep(name) {
  if (name === stepShown) return;
  stepShown = name;
  for (const b of steps) b.classList.toggle("is-on", b.dataset.step === name);
}
// Scroll picks the step; the step's video plays it. The scene is pinned for four equal stretches of scroll, one per
// step. Arriving at a step plays its clips once at real speed and holds the last frame, so the motion is the same
// however you scroll. The main clip is the clock: its frame drives the camera, tilt and captions, and the panel clips
// are kept in lockstep with it. Changing step fades the stage out briefly and the new step plays from its start.
const FADE_S = 0.22;
let scrollT = 0, cur = "simulate", fade = 1, waited = 0, raf = 0, last = 0;
/** The step the scroll position asks for, with a little hysteresis so a few pixels' wobble at a boundary doesn't
 * restart a step. */
function wanted() {
  const x = (scrollT / TL.total) * BEATS.length, i = BEATS.indexOf(cur);
  if (x > i - 0.12 && x < i + 1.12) return cur;
  return BEATS[clamp(Math.floor(x), 0, BEATS.length - 1)];
}
const endTime = (step) => (clipsInfo[step].frames - 1) / clipsInfo[step].fps;
function setClips(step, time, play) {
  for (const el of all(stepVideos(step))) {
    if (time != null && Math.abs(el.currentTime - time) > 0.001) el.currentTime = time;
    // A refusal to play (iPhone Low Power Mode, data saver) leaves the step on its last-frame still.
    if (play && el.paused) { const pr = el.play(); pr && pr.catch((e) => { if (e && e.name === "NotAllowedError") { stuck.add(step); kick(); } }); }
    if (!play && !el.paused) el.pause();
  }
}
function tick(now) {
  raf = 0;
  if (!ready) return;
  const dt = last ? Math.min(0.05, (now - last) / 1000) : 0;
  last = now;
  const want = wanted();
  let busy = false;
  if (want !== cur) {
    fade = Math.max(0, fade - dt / FADE_S);
    busy = true;
    if (fade === 0) { setClips(cur, null, false); cur = want; waited = 0; setClips(cur, 0, false); }
  } else {
    fade = Math.min(1, fade + dt / FADE_S);
    if (fade < 1) busy = true;
    const v = stepVideos(cur), main = v.main, end = endTime(cur);
    // The first step waits until the scene has actually reached the top of the window, so it plays in front of you.
    const arrived = cur !== BEATS[0] || entry > 0.98;
    if (entry < 0.15) { if (main.currentTime > 0 || !main.paused) setClips(cur, 0, false); }
    else if (!arrived) { if (!main.paused) setClips(cur, null, false); }
    else if (arrived) {
      waited += dt;
      if (stuck.has(cur)) { /* holds its last-frame still */ }
      else if (reduceMotion || main.currentTime >= end - 0.01) setClips(cur, end, false);
      else {
        // Play right away: iPhones only fetch a video once it plays, and it simply waits for data if it must.
        if (main.paused) setClips(cur, null, true);
        if (main.readyState >= 2) for (const el of all(v)) if (el !== main && Math.abs(el.currentTime - main.currentTime) > 0.06) el.currentTime = main.currentTime;
        if (waited > 8 && main.currentTime < 0.05) stuck.add(cur); // nothing arrived in 8 s: show the result instead
        busy = true;
      }
    }
  }
  if (!all(stepVideos(cur)).every(buffered)) busy = true; // keep checking, to start the next step's download
  if (near) loadAround(BEATS.indexOf(cur)); // nothing downloads until the scene is about a screen away
  render(cur, stuck.has(cur) ? clipsInfo[cur].frames - 1 : stepVideos(cur).main.currentTime * clipsInfo[cur].fps);
  if (busy) raf = requestAnimationFrame(tick);
  else last = 0;
}
function kick() { if (!raf) { last = 0; raf = requestAnimationFrame(tick); } }
for (const b of steps) {
  b.addEventListener("click", () => scene.scrollToT(((BEATS.indexOf(b.dataset.step) + 0.5) / BEATS.length) * TL.total));
}

// Entrance: the editor rises and tilts upright as the scene scrolls into view, instead of arriving as a flat image.
// Exit: 0 → 1 as the stage scrolls away after the pin releases.
let entry = 1, exit = 0, near = false;
const stepsEl = $("bl-steps");

let scene = null;
scene = pinScene({
  el: root, stage: root.querySelector(".scene-stage"), total: TL.total, unitVh: UNIT_VH, scrub: true,
  render: (t) => { scrollT = t; kick(); },
  onEntry: (e) => { entry = e; kick(); },
  onExit: (x) => { exit = x; kick(); },
  onNear: () => loadData.then(() => { near = true; loadAround(0); kick(); }),
  onResize: () => { screen.fit(); panel.fit(); },
});
loadData.then(kick);

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
