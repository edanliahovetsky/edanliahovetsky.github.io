// Deterministic frame capture for the BLine editor.
//
// The page runs on Playwright's paused fake clock: every captured frame advances
// virtual time by exactly 1/FPS, so animations, simulation playback, and drag
// previews render at true speed regardless of how long a screenshot takes.
// Pointer positions are logged per frame so the page can draw its own cursor.
// Adapted from the BLine 2027 launch film's capture/director.mjs. Playwright comes from the launch-video project.
import { createRequire } from "node:module";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawn } from "node:child_process";
import path from "node:path";
import { demoArchive } from "./demoProject.mjs";

const require = createRequire(
  `${process.env.HOME}/FRC/BLine-Web/.claude/worktrees/bline-2027-launch-video-3b60b0/launch-video/package.json`,
);
const { chromium } = require("playwright");

export const EDITOR_URL = process.env.BLINE_URL ?? "http://127.0.0.1:5199/";
export const FPS = 30;
const FRAME_MS = 1000 / FPS;

export const ease = {
  inOut: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  out: (t) => 1 - Math.pow(1 - t, 3),
  in: (t) => t * t * t,
  linear: (t) => t,
};

export class Director {
  constructor(page, outDir, { scale }) {
    this.page = page;
    this.outDir = outDir;
    this.scale = scale;
    this.frame = 0;
    this.recording = false;
    this.cursor = { x: 960, y: 540, down: false, visible: false };
    this.cursorLog = [];
    this.probeLog = [];
    /** Optional per-frame sampler, e.g. the simulated robot's page position. */
    this.probe = null;
    this.markers = {};
  }

  static async open({
    outDir,
    scale = 2,
    viewport = { width: 1920, height: 1080 },
  }) {
    await rm(outDir, { recursive: true, force: true });
    await mkdir(path.join(outDir, "frames"), { recursive: true });
    const browser = await chromium.launch();
    const context = await browser.newContext({
      viewport,
      deviceScaleFactor: scale,
      serviceWorkers: "block",
      reducedMotion: "no-preference",
    });
    const page = await context.newPage();
    await page.clock.install({ time: new Date("2026-09-26T12:00:00") });
    await page.goto(EDITOR_URL);
    await page.clock.pauseAt(new Date("2026-09-26T12:00:02"));
    const director = new Director(page, outDir, { scale });
    director.browser = browser;
    await director.idle(1500);
    return director;
  }

  /** Advance virtual time without recording (setup work between takes). */
  async idle(ms, realWaitMs = 4) {
    const steps = Math.ceil(ms / 50);
    for (let i = 0; i < steps; i++) {
      await this.page.clock.runFor(50);
      // Give workers (simulation, generator) real time to answer.
      if (realWaitMs) await this.page.waitForTimeout(realWaitMs);
    }
  }

  async tick(realWaitMs = 0) {
    await this.page.clock.runFor(FRAME_MS);
    if (realWaitMs) await this.page.waitForTimeout(realWaitMs);
    if (!this.recording) return;
    const name = String(this.frame).padStart(5, "0");
    await this.page.screenshot({
      path: path.join(this.outDir, "frames", `${name}.png`),
      animations: "allow",
      caret: "initial",
    });
    this.cursorLog.push({ ...this.cursor });
    this.probeLog.push(this.probe ? await this.probe() : null);
    this.frame++;
  }

  start() {
    this.recording = true;
  }

  mark(name) {
    this.markers[name] = this.frame;
  }

  async hold(frames, realWaitMs = 0) {
    for (let i = 0; i < frames; i++) await this.tick(realWaitMs);
  }

  async moveTo(
    x,
    y,
    frames,
    { curve = ease.inOut, arc = 0, realWaitMs = 0 } = {},
  ) {
    const from = { x: this.cursor.x, y: this.cursor.y };
    this.cursor.visible = true;
    for (let i = 1; i <= frames; i++) {
      const t = curve(i / frames);
      // A slight perpendicular arc keeps hand movement from looking robotic.
      const bow = Math.sin(Math.PI * t) * arc;
      const dx = x - from.x;
      const dy = y - from.y;
      const len = Math.hypot(dx, dy) || 1;
      const px = from.x + dx * t + (-dy / len) * bow;
      const py = from.y + dy * t + (dx / len) * bow;
      this.cursor.x = px;
      this.cursor.y = py;
      await this.page.mouse.move(px, py);
      await this.tick(realWaitMs);
    }
  }

  async down() {
    this.cursor.down = true;
    await this.page.mouse.down();
  }

  async up() {
    this.cursor.down = false;
    await this.page.mouse.up();
  }

  async click(x, y, { travel = 14, settle = 4 } = {}) {
    if (x !== undefined) await this.moveTo(x, y, travel);
    await this.down();
    await this.tick();
    await this.tick();
    await this.up();
    await this.hold(settle);
  }

  async drag(points, framesPerLeg, { realWaitMs = 30 } = {}) {
    await this.down();
    await this.hold(2);
    for (const [x, y] of points) {
      await this.moveTo(x, y, framesPerLeg, { realWaitMs });
    }
    await this.hold(3, realWaitMs);
    await this.up();
  }

  /** Page position of a Pixi debug node (canvas-local stage point + canvas offset). */
  async node(id) {
    return this.page.evaluate((nodeId) => {
      const point = window.__blinePixiDebug?.nodePosition(nodeId);
      const canvas = document.querySelector(".path-stage canvas");
      if (!point || !canvas) return null;
      const rect = canvas.getBoundingClientRect();
      return { x: rect.x + point.x, y: rect.y + point.y };
    }, id);
  }

  /** Page position of a field coordinate, using the editor's fit-to-view layout. */
  async field(xMeters, yMeters) {
    const rect = await this.page
      .locator(".path-stage canvas")
      .first()
      .boundingBox();
    const length = 17.54,
      width = 9.07,
      offset = 0.5;
    const padding = Math.min(24, rect.width / 12, rect.height / 12);
    const scale = Math.min(
      (rect.width - padding * 2) / length,
      (rect.height - padding * 2) / width,
    );
    const vx = rect.x + (rect.width - length * scale) / 2;
    const vy = rect.y + (rect.height - width * scale) / 2;
    return {
      x: vx + (xMeters + offset) * scale,
      y: vy + (width - yMeters - offset) * scale,
    };
  }

  async key(key) {
    await this.page.keyboard.press(key);
  }

  async box(locator) {
    const box = await locator.boundingBox();
    if (!box) throw new Error(`No box for ${locator}`);
    return { ...box, cx: box.x + box.width / 2, cy: box.y + box.height / 2 };
  }

  async finish(meta = {}) {
    await writeFile(
      path.join(this.outDir, "take.json"),
      JSON.stringify(
        {
          fps: FPS,
          scale: this.scale,
          frames: this.frame,
          markers: this.markers,
          cursor: this.cursorLog.map((c) => [
            Math.round(c.x * 10) / 10,
            Math.round(c.y * 10) / 10,
            c.down ? 1 : 0,
            c.visible ? 1 : 0,
          ]),
          probe: this.probeLog.some(Boolean) ? this.probeLog : undefined,
          ...meta,
        },
        null,
        0,
      ),
    );
    await this.browser.close();
  }
}

/** Import the demo project archive from Home and open its first path. */
export async function importDemoProject(director, archiveOptions) {
  const { page } = director;
  const chooser = page.waitForEvent("filechooser");
  await page.getByRole("button", { name: "File", exact: true }).click();
  await director.idle(200);
  await page
    .getByRole("menuitem", { name: "Import / Export", exact: true })
    .click();
  await director.idle(200);
  await page
    .getByRole("menuitem", { name: "Import Project Archive...", exact: true })
    .click();
  await (
    await chooser
  ).setFiles({
    name: "launch-demo.bline.json",
    mimeType: "application/json",
    buffer: Buffer.from(JSON.stringify(demoArchive(archiveOptions))),
  });
  await director.idle(2500, 10);
}

export async function selectPath(director, name) {
  const { page } = director;
  await page.getByRole("button", { name: "Toolbar path", exact: true }).click();
  await director.idle(250, 10);
  await page
    .getByRole("option", { name: new RegExp(`^${name}`) })
    .first()
    .click();
  await director.idle(1200, 20);
}

/** Encode a take's PNG frames to a high-quality intermediate video. */
export function encodeTake(outDir, { crf = 12 } = {}) {
  return new Promise((resolve, reject) => {
    const ff = spawn(
      "ffmpeg",
      [
        "-loglevel",
        "error",
        "-y",
        "-framerate",
        String(FPS),
        "-i",
        path.join(outDir, "frames", "%05d.png"),
        "-c:v",
        "libx264",
        "-preset",
        "slow",
        "-crf",
        String(crf),
        "-pix_fmt",
        "yuv420p",
        "-movflags",
        "+faststart",
        path.join(outDir, "take.mp4"),
      ],
      { stdio: "inherit" },
    );
    ff.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`ffmpeg ${code}`)),
    );
  });
}
