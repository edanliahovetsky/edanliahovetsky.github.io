// Scripted takes of the real BLine 2027 beta editor for the site's BLine scene, one per step.
//
//   node scripts/capture/takes.mjs <take ...|all> [--scale=2]
//
// Needs the beta editor served on 127.0.0.1:5199 (see AGENTS.md). Each take writes
// assets/source/takes/<name>/frames/*.png (3840×2160 at FPS) + take.json (cursor path, markers, robot positions).
// scripts/build-clips.py turns those frames into the per-step videos the page plays.
//
// Each step tells one small story with a visible result (storyboard agreed with Edan, Oct 11 2026):
//   simulate  sketch a route with the Curve tool, it becomes points, press play, the robot drives it
//   generate  the run shows its default time, Generate tunes every turn and speed, the replay is faster
//   organize  the Project Navigator: focus path groups (their paths light up), then wire a path into a group
//   learn     the lesson list, then Path Tuning: approach the bend, cross the handoff, lower acceleration widens the turn
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Director, FPS, ease, importDemoProject } from "./director.mjs";
import { demoGroups, demoPaths, startPoint } from "./demoProject.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith("--scale="))?.split("=")[1] ?? 2);
const outDir = (name) => path.join(root, "assets", "source", "takes", name);
/** Seconds to frames. */
const S = (sec) => Math.max(1, Math.round(sec * FPS));

async function openProject(name, archive) {
  const d = await Director.open({ outDir: outDir(name), scale });
  await importDemoProject(d, archive);
  return d;
}
async function hideInspector(d) {
  await d.page.getByRole("button", { name: "Toggle inspector" }).click();
  await d.idle(600, 20);
}
const robotProbe = (d) => async () => {
  const robot = await d.node("simulation-robot");
  return robot ? [Math.round(robot.x * 10) / 10, Math.round(robot.y * 10) / 10] : null;
};
/** The transport's "elapsed / total s" label, e.g. 4.88. */
const runTime = (page) => page.evaluate(() => {
  for (const e of document.querySelectorAll(".path-stage *")) {
    const m = e.childElementCount === 0 && e.textContent.trim().match(/^[\d.]+\s*\/\s*([\d.]+)\s*s$/);
    if (m) return Number(m[1]);
  }
  return null;
});
/** Presses a button with the cursor: travel there, press, release. */
async function press(d, locator, travelSec = 0.7, arc = 30) {
  const b = await d.box(locator);
  await d.moveTo(b.cx, b.cy, S(travelSec), { arc });
  await d.down();
  await d.tick();
  await d.tick();
  await d.up();
}
/** Drags the cursor smoothly through field points (meters), as a hand sketching a curve. */
async function sketch(d, points, sec) {
  const P = [];
  for (const [x, y] of points) P.push(await d.field(x, y));
  // Catmull-Rom through the points, sampled by arc length so the pen moves at an even speed.
  const seg = (i, t) => {
    const p0 = P[Math.max(0, i - 1)], p1 = P[i], p2 = P[i + 1], p3 = P[Math.min(P.length - 1, i + 2)];
    const t2 = t * t, t3 = t2 * t;
    const f = (a, b, c, e) => 0.5 * (2 * b + (-a + c) * t + (2 * a - 5 * b + 4 * c - e) * t2 + (-a + 3 * b - 3 * c + e) * t3);
    return { x: f(p0.x, p1.x, p2.x, p3.x), y: f(p0.y, p1.y, p2.y, p3.y) };
  };
  const dense = [];
  for (let i = 0; i < P.length - 1; i++) for (let k = 0; k < 40; k++) dense.push(seg(i, k / 40));
  dense.push(P[P.length - 1]);
  const len = [0];
  for (let i = 1; i < dense.length; i++) len.push(len[i - 1] + Math.hypot(dense[i].x - dense[i - 1].x, dense[i].y - dense[i - 1].y));
  const total = len[len.length - 1], n = S(sec);
  let j = 0;
  for (let f = 1; f <= n; f++) {
    const want = ease.inOut(f / n) * total;
    while (j < len.length - 2 && len[j + 1] < want) j++;
    const k = (want - len[j]) / (len[j + 1] - len[j] || 1);
    const x = dense[j].x + (dense[j + 1].x - dense[j].x) * k, y = dense[j].y + (dense[j + 1].y - dense[j].y) * k;
    d.cursor.x = x; d.cursor.y = y;
    await d.page.mouse.move(x, y);
    await d.tick(8);
  }
}

const takes = {
  /** Simulate. — sketch a route with the Curve tool; it becomes points; press play and the robot drives it. */
  async simulate() {
    const { "Center Sweep": _, ...rest } = demoPaths;
    const d = await openProject("simulate", { paths: { "Center Sweep": [startPoint], ...rest }, groups: {} });
    const { page } = d;
    await hideInspector(d);
    // The hero route: out along the top trench, around the far side of the fuel, back along the bottom trench.
    const route = [[3.6, 7.35], [4.8, 7.35], [5.9, 7.35], [7.0, 7.0], [7.75, 6.3], [7.95, 4.2], [7.75, 2.0], [7.0, 1.0],
      [5.9, 0.7], [4.6, 0.7], [3.4, 0.75], [3.0, 2.3]];
    const first = await d.field(...route[0]);
    d.cursor = { x: first.x + 260, y: first.y + 260, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.probe = robotProbe(d);
    d.start();
    await d.hold(S(0.4));
    // Pick the Curve tool ("Draw a sequence of position targets") from the toolbar, then sketch.
    await press(d, page.getByRole("button", { name: /Curve tool/ }).first(), 0.6, 30);
    await d.hold(S(0.2));
    await d.moveTo(first.x, first.y, S(0.6), { arc: 40 });
    await d.down();
    d.mark("draw");
    await sketch(d, route, 2.6);
    await d.up();
    d.mark("drawn");
    await d.hold(S(0.9), 20); // the stroke settles into position targets and the trail solves
    await d.key("v");
    await press(d, page.getByRole("button", { name: "Play simulation" }), 0.8, -50);
    d.mark("play");
    const t = (await runTime(page)) ?? 4.5;
    await d.hold(S(t + 0.4), 8);
    d.mark("end");
    await d.hold(S(0.6));
    return d;
  },

  /** Generate. — the default run's time, one click to tune, then the faster replay. */
  async generate() {
    const d = await openProject("generate");
    const { page } = d;
    await page.getByRole("tab", { name: "Constraints", exact: true }).click();
    await d.idle(500, 20);
    // Before: the whole default run already drawn, with its time on the transport.
    await page.getByRole("button", { name: "Fast forward simulation" }).click();
    await d.idle(900, 30);
    const before = await runTime(page);
    const gen = page.getByRole("button", { name: "Generate constraints" });
    const gb = await d.box(gen);
    d.cursor = { x: gb.cx - 520, y: gb.cy + 420, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.probe = robotProbe(d);
    d.start();
    await d.hold(S(0.8));
    await press(d, gen, 0.8, 50);
    d.mark("generate");
    await d.hold(S(1.6), 60); // the solver picks every handoff radius and speed limit; the chips fill in
    const after = await runTime(page);
    await press(d, page.getByRole("button", { name: "Reset simulation" }), 0.8, -30);
    await d.hold(S(0.25));
    await press(d, page.getByRole("button", { name: "Play simulation" }), 0.25, 0);
    d.mark("replay");
    await d.hold(S((after ?? 4.1) + 0.3), 8);
    d.mark("end");
    await d.hold(S(0.8));
    d.times = { before, after };
    return d;
  },

  /** Organize. — the Project Navigator's web of path groups and paths: focus groups, then wire a path in. */
  async organize() {
    const d = await openProject("organize");
    const { page } = d;
    await page.getByRole("button", { name: /Open project navigator/i }).click();
    await d.idle(900, 20);
    const nav = page.getByRole("dialog", { name: "Project Navigator" }).or(page.locator("[aria-label='Project Navigator']")).first();
    const focus = (name) => nav.getByRole("button", { name: `Focus ${name}`, exact: true });
    const row = (name) => nav.locator(".fc-row").filter({ has: page.getByRole("button", { name: `Focus ${name}`, exact: true }) });
    d.cursor = { x: 900, y: 760, down: false, visible: true };
    await page.mouse.move(900, 760);
    d.start();
    await d.hold(S(0.5));
    for (const [i, g] of ["Full Field", "Outpost Auto", "Depot + Steal"].entries()) {
      const b = await d.box(focus(g));
      await d.moveTo(b.cx, b.cy, S(i ? 0.45 : 0.6), { arc: 30 });
      await d.down(); await d.tick(); await d.tick(); await d.up();
      d.mark(`group${i + 1}`);
      await d.hold(S(1.1), 20);
    }
    // Wire a path into the focused group by dragging between ports.
    const from = await d.box(row("Sweep + Climb").locator(".fc-port"));
    const to = await d.box(row("Steal Top").locator(".fc-port"));
    await d.moveTo(from.cx, from.cy, S(0.45));
    await d.down();
    d.mark("dragStart");
    await d.hold(S(0.1));
    await d.moveTo(to.cx, to.cy, S(0.8), { realWaitMs: 10, arc: -30 });
    await d.hold(S(0.1));
    await d.up();
    d.mark("connected");
    await d.hold(S(1.6), 20);
    return d;
  },

  /** Learn. — the lesson list, then Path Tuning: approach the bend, cross the handoff, a wider turn. */
  async learn() {
    const d = await Director.open({ outDir: outDir("learn"), scale });
    const { page } = d;
    const lessons = page.getByRole("button", { name: /Lessons/ }).first();
    const lb = await d.box(lessons);
    d.cursor = { x: lb.cx - 300, y: lb.cy + 200, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.start();
    await d.hold(S(0.3));
    await press(d, lessons, 0.5, 20);
    d.mark("list");
    await d.hold(S(0.5), 10);
    await press(d, page.getByRole("button", { name: /Path Tuning/ }), 0.6, -40);
    d.mark("lesson");
    await d.hold(S(2.6), 10); // approach the bend
    const next = () => page.getByRole("button", { name: "Continue" });
    await press(d, next(), 0.5, 30);
    d.mark("cross");
    await d.hold(S(3.0), 10); // the camera moves in as the robot crosses the 0.70 m handoff
    await press(d, next(), 0.4, 20);
    d.mark("target");
    await d.hold(S(0.8), 10);
    await press(d, next(), 0.4, 20);
    d.mark("wide");
    await d.hold(S(3.2), 10); // lower acceleration makes a wider turn
    return d;
  },
};

const requested = args.filter((a) => !a.startsWith("--"));
const names = requested.includes("all") ? Object.keys(takes) : requested;
for (const name of names) {
  const started = Date.now();
  const d = await takes[name]();
  await d.finish({ take: name, groups: Object.keys(demoGroups).length, ...(d.times ? { times: d.times } : {}) });
  console.log(`${name}: ${d.frame} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`, d.markers, d.times ?? "");
}
