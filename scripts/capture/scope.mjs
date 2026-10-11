// Records the Agents chapter's live AdvantageScope-style session (assets/js/scope-live.js) as video, so the page can
// play a recording instead of running three.js and the telemetry replay on every visitor's machine.
//
//   node scripts/capture/scope.mjs <desktop|phone>
//
// Needs the site served on 127.0.0.1:8001 (python3 scripts/serve.py 8001). Opens the page with ?scope-live on a
// paused fake clock, scrolls to the session, and captures the .scope-main area (tabs, 3D/swerve/graph view, timeline)
// frame by frame for one full loop of the six scenes. The agent log isn't recorded as pixels: the live renderer logs
// every message with its time, and the page replays them as HTML in step with the video (assets/js/scope.js).
// Writes assets/source/scope/<layout>/frames/*.png and events.json; scripts/build-scope.py encodes them.
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(`${process.env.HOME}/FRC/BLine-Web/.claude/worktrees/bline-2027-launch-video-3b60b0/launch-video/package.json`);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const layout = process.argv[2] || "desktop";
const FPS = 30, FRAME_MS = 1000 / FPS;
const VIEW = {
  desktop: { viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 2 },
  phone: { viewport: { width: 402, height: 874 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true },
}[layout];
const out = path.join(root, "assets", "source", "scope", layout);
await rm(out, { recursive: true, force: true });
await mkdir(path.join(out, "frames"), { recursive: true });

const browser = await chromium.launch({ channel: "chrome" });
const page = await (await browser.newContext({ ...VIEW, reducedMotion: "no-preference" })).newPage();
await page.clock.install({ time: new Date("2026-10-11T12:00:00") });
// One animation frame per captured frame (Playwright's fake requestAnimationFrame runs on a 16 ms grid).
await page.addInitScript((P) => {
  // At least 1 ms ahead: a near-zero delay would let a loop that re-requests a frame spin forever on a paused clock.
  window.requestAnimationFrame = (cb) => { let d = P - (performance.now() % P); if (d < 1) d += P; return setTimeout(() => cb(performance.now()), d); };
  window.cancelAnimationFrame = (id) => clearTimeout(id);
}, FRAME_MS);
await page.goto("http://127.0.0.1:8001/?scope-live", { waitUntil: "domcontentloaded" });
await page.clock.pauseAt(new Date("2026-10-11T12:00:02"));
const idle = async (ms) => { for (let i = 0; i < ms / 50; i++) { await page.clock.runFor(50); await page.waitForTimeout(8); } };
await idle(800);
// Bring the session into view (it starts when 20% visible) and let it build: the log loads and the field texture
// arrives over the real network, so give it real time as well as page time.
await page.evaluate(() => { const r = document.querySelector("#scope").getBoundingClientRect(); scrollTo(0, scrollY + r.top - 70); });
for (let i = 0; i < 400; i++) {
  await page.clock.runFor(50); await page.waitForTimeout(20);
  if (await page.evaluate(() => window.__scope && window.__scope.scene === 0 && document.querySelector("#scope-title").textContent.includes("—"))) break;
}
await idle(400); // let the field texture appear
const meta = await page.evaluate(() => {
  const m = document.querySelector("#scope .scope-main").getBoundingClientRect();
  return { title: document.querySelector("#scope-title").textContent, clip: { x: Math.round(m.left), y: Math.round(m.top), width: Math.round(m.width), height: Math.round(m.height) } };
});
// The loop restarts from scene 0: a run that starts mid-way would replay out of order, so restart cleanly.
await page.evaluate(() => { window.__scopeEvents = []; document.querySelector("#agent-steps button").click(); });
const t0 = await page.evaluate(() => performance.now());
let frame = 0, scenes = [0];
for (;;) {
  await page.clock.runFor(FRAME_MS);
  const s = await page.evaluate(() => window.__scope.scene);
  if (s !== scenes[scenes.length - 1]) { if (s === 0) break; scenes.push(s); }
  await page.screenshot({ path: path.join(out, "frames", `${String(frame).padStart(5, "0")}.png`), clip: meta.clip, animations: "allow", caret: "initial" });
  frame++;
  if (frame % 300 === 0) console.log(layout, frame, "frames, scene", s);
}
const events = (await page.evaluate(() => window.__scopeEvents)).map((e) => ({ ...e, t: Math.max(0, e.t - Math.round(t0)) })).filter((e) => e.t < (frame * 1000) / FPS);
await writeFile(path.join(out, "events.json"), JSON.stringify({ fps: FPS, frames: frame, title: meta.title, size: [meta.clip.width, meta.clip.height], events }));
console.log(`${layout}: ${frame} frames (${(frame / FPS).toFixed(1)} s), ${events.length} events, clip ${meta.clip.width}x${meta.clip.height}`);
await browser.close();
