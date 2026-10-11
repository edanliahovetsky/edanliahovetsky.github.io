"""Renders assets/media/bline-champs.mp4 with a floating "2638" label over our robot (no box).
Position comes from the hand-placed bumper corners (corners.json, every 3rd frame), interpolated and smoothed;
the label sits a fixed height above the bumpers' top edge."""
import cv2, numpy as np, json, sys, os, subprocess
from PIL import Image, ImageDraw, ImageFont, ImageFilter
S, OUT = sys.argv[1], sys.argv[2]
HERE = os.path.dirname(os.path.abspath(__file__)); sys.path.insert(0, HERE)
from grade import grade
F0, END = 27, int(round((21.2 - 4.5) * 30))
X0, Y0, W, H = 440, 0, 1480, 700
ann = {int(k): np.array(v["corners"], float) for k, v in json.load(open(os.path.join(HERE, "corners.json"))).items() if v}
ks = sorted(ann)
cx = np.array([ann[k][:, 0].mean() for k in ks]); top = np.array([ann[k][:, 1].min() for k in ks])
idx = np.arange(F0, END)
X = np.interp(idx, ks, cx); Y = np.interp(idx, ks, top)
def gs(v, s):
    k = np.exp(-0.5 * (np.arange(-3 * s, 3 * s + 1) / s) ** 2); k /= k.sum(); return np.convolve(np.pad(v, 3 * s, mode="edge"), k, "valid")
X, Y = gs(X, 5), gs(Y, 5)

# Label sprite (drawn once at 2x, with a soft glow): rounded pill + pointer.
SC = 2; font = ImageFont.truetype("/System/Library/Fonts/Supplemental/Arial Bold.ttf", 26 * SC)
tw = font.getbbox("2638")[2]; pw, ph, tip = tw + 30 * SC, 40 * SC, 12 * SC
sw, sh = pw + 60 * SC, ph + tip + 60 * SC
spr = Image.new("RGBA", (sw, sh), (0, 0, 0, 0)); d = ImageDraw.Draw(spr)
ox, oy = 30 * SC, 30 * SC
blue = (77, 163, 255, 255)
d.rounded_rectangle([ox, oy, ox + pw, oy + ph], radius=ph // 2, fill=blue)
d.polygon([(sw // 2 - tip, oy + ph - 2), (sw // 2 + tip, oy + ph - 2), (sw // 2, oy + ph + tip)], fill=blue)
glow = spr.filter(ImageFilter.GaussianBlur(10 * SC)); g2 = Image.new("RGBA", spr.size); g2.paste((77, 163, 255, 0), (0, 0, sw, sh))
d.text((sw // 2, oy + ph // 2 + 1), "2638", font=font, fill=(255, 255, 255, 255), anchor="mm")
out = Image.alpha_composite(Image.fromarray((np.asarray(glow).astype(float) * [1, 1, 1, 0.9]).astype(np.uint8)), spr)
out = out.resize((sw // SC, sh // SC), Image.LANCZOS)
SPR = np.asarray(out).astype(np.float32) / 255; sh2, sw2 = SPR.shape[:2]
TIPX, TIPY = sw2 / 2, (oy + ph + tip) / SC   # pointer tip inside the sprite
LIFT = 58  # px above the bumpers' top edge: roughly the robot's height in this view

cap = cv2.VideoCapture(f"{S}/cm/auto30.mp4"); frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{H}", "-r", "30", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", OUT], stdin=subprocess.PIPE)
for n, i in enumerate(idx):
    img = grade(frames[i][Y0:Y0 + H, X0:X0 + W]).astype(np.float32) / 255
    t = i / 30 + 4.5; a = np.clip((t - 5.6) / 0.4, 0, 1) * (1 + 0.04 * np.sin(t * 3.0))   # fade in, gentle breathe
    bob = 2.5 * np.sin(t * 2.4)
    px, py = X[n] - X0 - TIPX, Y[n] - Y0 - LIFT - TIPY + bob
    x0, y0 = int(round(px)), int(round(py))
    xa, ya, xb, yb = max(0, x0), max(0, y0), min(W, x0 + sw2), min(H, y0 + sh2)
    if xb > xa and yb > ya:
        sp = SPR[ya - y0:yb - y0, xa - x0:xb - x0]; al = sp[..., 3:4] * min(a, 1)
        img[ya:yb, xa:xb] = img[ya:yb, xa:xb] * (1 - al) + sp[..., [2, 1, 0]] * al
    ff.stdin.write((np.clip(img, 0, 1) * 255).astype(np.uint8).tobytes())
ff.stdin.close(); ff.wait(); print("done", OUT)
