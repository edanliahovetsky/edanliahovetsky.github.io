// Scripted takes of the real BLine 2027 beta editor for the site's BLine scene.
//
//   node scripts/capture/takes.mjs <take ...|all> [--scale=2]
//
// Needs the beta editor served on 127.0.0.1:5199 (see scripts/capture/README.md).
// Each take writes assets/source/takes/<name>/frames/*.png (3840×2160) + take.json (cursor path, markers).
// scripts/build-takes.sh turns those frames into the WebP sequences the page scrubs.
// Choreography follows the launch film's capture/takes.mjs, re-paced for scrolling: building the path is quick,
// Generate, Organize and Learn get the time.
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Director, ease, importDemoProject, selectPath } from "./director.mjs";
import { demoGroups, demoPaths, heroPoints } from "./demoProject.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const args = process.argv.slice(2);
const scale = Number(args.find((a) => a.startsWith("--scale="))?.split("=")[1] ?? 2);
const outDir = (name) => path.join(root, "assets", "source", "takes", name);

async function openProject(name, archive) {
  const d = await Director.open({ outDir: outDir(name), scale });
  await importDemoProject(d, archive);
  return d;
}
async function generate(d) {
  await d.page.getByRole("tab", { name: "Constraints", exact: true }).click();
  await d.idle(300, 20);
  await d.page.getByRole("button", { name: "Generate constraints" }).click();
  await d.idle(1500, 60);
}
async function hideInspector(d) {
  await d.page.getByRole("button", { name: "Toggle inspector" }).click();
  await d.idle(600, 20);
}
const robotProbe = (d) => async () => {
  const robot = await d.node("simulation-robot");
  return robot ? [Math.round(robot.x * 10) / 10, Math.round(robot.y * 10) / 10] : null;
};

const takes = {
  /** Point. Line. Path. — a blank path built from the empty-state card, then the simulated trail. */
  async build() {
    const d = await openProject("build", { paths: { "Center Sweep": [], ...withoutHero() }, groups: {} });
    const { page } = d;
    const card = page.getByRole("button", { name: "Use waypoint tool", exact: true });
    const cardBox = await d.box(card);
    d.cursor = { x: 1500, y: 900, down: false, visible: true };
    await page.mouse.move(1500, 900);
    d.start();
    await d.hold(3);
    await d.moveTo(cardBox.cx, cardBox.cy, 14, { arc: 40 });
    await d.click(undefined, undefined, { settle: 1 });
    d.mark("tool");
    for (let i = 0; i < heroPoints.length; i++) {
      const [x, y, tool] = heroPoints[i];
      if (i > 0 && tool !== heroPoints[i - 1][2]) await d.key(tool);
      const target = await d.field(x, y);
      await d.moveTo(target.x, target.y, i === 0 ? 12 : 8, { curve: ease.inOut, arc: i % 2 ? 14 : -14 });
      d.mark(`point${i}`);
      await d.click(undefined, undefined, { settle: 0 });
    }
    await d.key("v");
    await d.hold(4, 20);
    d.mark("end");
    await d.key("l");
    await d.hold(3, 40);
    d.mark("trail");
    await d.hold(24, 20);
    return d;
  },

  /** Shape. — drag a target; the live preview re-simulates the trail. */
  async shape() {
    const d = await openProject("shape");
    await generate(d);
    const { page } = d;
    await page.getByRole("tab", { name: "Elements", exact: true }).click();
    await page.getByRole("button", { name: "Fast forward simulation" }).click();
    await d.idle(800, 30);
    const target = await d.node("path-element-node-3");
    d.cursor = { x: target.x + 260, y: target.y + 220, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.start();
    await d.hold(2);
    await d.moveTo(target.x, target.y, 14, { arc: 30 });
    await d.down();
    d.mark("grab");
    await d.hold(2, 30);
    const a = await d.field(9.3, 7.2), b = await d.field(6.5, 5.0), c = await d.field(7.75, 6.3);
    await d.moveTo(a.x, a.y, 24, { realWaitMs: 40, arc: 60 });
    await d.moveTo(b.x, b.y, 30, { realWaitMs: 40, arc: -80 });
    await d.moveTo(c.x, c.y, 22, { realWaitMs: 40, arc: 40 });
    await d.hold(3, 40);
    await d.up();
    d.mark("release");
    await d.hold(10, 40);
    return d;
  },

  /** Press play. — the simulated robot runs the generated hero path. */
  async play() {
    const d = await openProject("play");
    await generate(d);
    await hideInspector(d);
    const { page } = d;
    const play = page.getByRole("button", { name: "Play simulation" });
    const playBox = await d.box(play);
    d.cursor = { x: playBox.cx + 380, y: playBox.cy - 300, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.probe = robotProbe(d);
    d.start();
    await d.hold(4);
    await d.moveTo(playBox.cx, playBox.cy, 22, { arc: -50 });
    await d.hold(4);
    await d.down();
    await d.tick();
    await d.up();
    d.mark("play");
    await d.hold(Math.round(30 * 4.0), 10);
    return d;
  },

  montageDepot: () => montage("montageDepot", "Depot Run"),
  montageOutpost: () => montage("montageOutpost", "Outpost Feed"),
  montageSteal: () => montage("montageSteal", "Steal Top"),
  montageTower: () => montage("montageTower", "Tower Climb"),

  /** Generate. — the solver picks every handoff radius and velocity cap together. */
  async generate() {
    const d = await openProject("generate");
    const { page } = d;
    await page.getByRole("tab", { name: "Constraints", exact: true }).click();
    await d.idle(600, 20);
    const button = page.getByRole("button", { name: "Generate constraints" });
    const box = await d.box(button);
    d.cursor = { x: box.cx - 520, y: box.cy + 420, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.start();
    await d.hold(4);
    await d.moveTo(box.cx, box.cy, 24, { arc: 50 });
    await d.hold(4);
    await d.down();
    await d.tick();
    await d.up();
    d.mark("generate");
    await d.hold(40, 60);
    const chips = page.locator(".constraint-editor [class*=chip], .constraint-editor button").filter({ hasText: /m\/s/ });
    if (await chips.count()) {
      const chip = await d.box(chips.nth(Math.min(1, (await chips.count()) - 1)));
      await d.moveTo(chip.cx, chip.cy, 18, { arc: 30 });
      d.mark("hover");
    }
    await d.hold(50, 20);
    return d;
  },

  /** Organize. — the Project Navigator's web of groups and paths; focusing groups lights their wires. */
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
    await d.hold(3);
    for (const [i, g] of ["Full Field", "Outpost Auto", "Depot + Steal"].entries()) {
      const b = await d.box(focus(g));
      await d.moveTo(b.cx, b.cy, i ? 12 : 16, { arc: 30 });
      await d.click(undefined, undefined, { settle: 0 });
      d.mark(`group${i + 1}`);
      await d.hold(22, 20);
    }
    // Wire a path into a group by dragging between ports.
    const from = await d.box(row("Sweep + Climb").locator(".fc-port"));
    const to = await d.box(row("Steal Top").locator(".fc-port"));
    await d.moveTo(from.cx, from.cy, 12);
    await d.down();
    d.mark("dragStart");
    await d.hold(2);
    await d.moveTo(to.cx, to.cy, 22, { realWaitMs: 10, arc: -30 });
    await d.hold(3);
    await d.up();
    d.mark("connected");
    await d.hold(30, 20);
    return d;
  },

  /** Learn. — open the lessons, start Path Tuning, advance into its camera move. */
  async learn() {
    const d = await Director.open({ outDir: outDir("learn"), scale });
    const { page } = d;
    const lessons = page.getByRole("button", { name: /Lessons/ }).first();
    const lb = await d.box(lessons);
    d.cursor = { x: lb.cx - 300, y: lb.cy + 200, down: false, visible: true };
    await page.mouse.move(d.cursor.x, d.cursor.y);
    d.start();
    await d.hold(3);
    await d.moveTo(lb.cx, lb.cy, 14, { arc: 20 });
    await d.click(undefined, undefined, { settle: 0 });
    d.mark("list");
    await d.hold(14, 10);
    const tuning = page.getByRole("button", { name: /Path Tuning/ });
    const tb = await d.box(tuning);
    await d.moveTo(tb.cx, tb.cy, 18, { arc: -40 });
    await d.hold(4);
    await d.click(undefined, undefined, { settle: 0 });
    d.mark("lesson");
    await d.hold(80, 10);
    const next = page.getByRole("button", { name: "Continue" });
    const nb = await d.box(next);
    await d.moveTo(nb.cx, nb.cy, 16, { arc: 30 });
    await d.click(undefined, undefined, { settle: 0 });
    d.mark("step2");
    await d.hold(150, 10);
    return d;
  },

  /** And more. — command palette search. */
  async palette() {
    const d = await openProject("palette");
    await generate(d);
    const { page } = d;
    d.cursor = { x: 960, y: 600, down: false, visible: false };
    d.start();
    await d.hold(4);
    await page.keyboard.press("ControlOrMeta+k");
    d.mark("open");
    await d.hold(8, 10);
    for (const ch of "gener") { await page.keyboard.type(ch); await d.hold(3, 10); }
    await d.hold(24, 10);
    return d;
  },
};

function withoutHero() {
  const { "Center Sweep": _, ...rest } = demoPaths;
  return rest;
}

async function montage(name, pathName) {
  const d = await openProject(name);
  await selectPath(d, pathName);
  await generate(d);
  await hideInspector(d);
  d.probe = robotProbe(d);
  d.cursor.visible = false;
  d.start();
  await d.hold(2);
  await d.page.getByRole("button", { name: "Play simulation" }).click();
  d.mark("play");
  await d.hold(Math.round(30 * 4.6), 10);
  return d;
}

const requested = args.filter((a) => !a.startsWith("--"));
const names = requested.includes("all") ? Object.keys(takes) : requested;
for (const name of names) {
  const started = Date.now();
  const d = await takes[name]();
  await d.finish({ take: name, groups: Object.keys(demoGroups).length });
  console.log(`${name}: ${d.frame} frames in ${((Date.now() - started) / 1000).toFixed(1)}s`, d.markers);
}
