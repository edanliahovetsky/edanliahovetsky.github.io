// Makes assets/img/og.jpg, the link preview (LinkedIn, iMessage, Slack): the hero with its photo and the five chapter
// cards, fitted into 1200x630 on the page's own dark background.
//
//   node scripts/capture/og.mjs   (needs the site on 127.0.0.1:8001 and Python with Pillow + NumPy)
//
// After changing it, bump the ?v= on og:image in index.html so services fetch the new one.
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import os from "node:os";

const require = createRequire(`${process.env.HOME}/FRC/BLine-Web/.claude/worktrees/bline-2027-launch-video-3b60b0/launch-video/package.json`);
const { chromium } = require("playwright");
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const shot = path.join(os.tmpdir(), "og-2x.png");

const b = await chromium.launch({ channel: "chrome" });
const p = await (await b.newContext({ viewport: { width: 1200, height: 900 }, deviceScaleFactor: 2, reducedMotion: "reduce" })).newPage();
await p.goto("http://127.0.0.1:8001/?og", { waitUntil: "load" });
await p.addStyleTag({ content: "#bar, #progress { display: none !important; }" });
await p.waitForTimeout(2500);
await p.screenshot({ path: shot });
await b.close();

// Crop to the rows that hold content (plus a margin), scale to 630 tall, and extend the sides with the edge columns.
execFileSync("python3", ["-c", `
import sys, numpy as np
from PIL import Image
im = Image.open(sys.argv[1]).convert("RGB")
a = np.asarray(im).astype(int); rows = np.where((a.max(axis=2) > 60).sum(axis=1) > 20)[0]
crop = im.crop((0, rows.min() - 70, im.width, rows.max() + 70)); h = 630; w = round(crop.width * h / crop.height)
crop = crop.resize((w, h), Image.LANCZOS); out = Image.new("RGB", (1200, 630)); x = (1200 - w) // 2
out.paste(crop.crop((0, 0, 2, h)).resize((x + 1, h)), (0, 0)); out.paste(crop.crop((w - 2, 0, w, h)).resize((1200 - w - x + 1, h)), (x + w - 1, 0))
out.paste(crop, (x, 0)); out.save(sys.argv[2], quality=88, optimize=True, progressive=True)
`, shot, path.join(root, "assets/img/og.jpg")], { stdio: "inherit" });
console.log("wrote assets/img/og.jpg");
