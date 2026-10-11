import cv2, numpy as np, json, sys, subprocess
S, OUT = sys.argv[1], sys.argv[2]
sys.path.insert(0, S); from grade import grade
H = np.array(json.load(open(f"{S}/cm/H.json"))["H"]); Hi = np.linalg.inv(H)
R = json.load(open(f"{S}/cm/recs.json")); F0, recs = R["F0"], R["recs"]
to_img = lambda p: cv2.perspectiveTransform(np.asarray(p, np.float32).reshape(-1, 1, 2), H).reshape(-1, 2)
to_fld = lambda p: cv2.perspectiveTransform(np.asarray(p, np.float32).reshape(-1, 1, 2), Hi).reshape(-1, 2)
# Hand-placed footprint centres (image px) where the detector can't see the bumpers (start, behind the bump).
KEYS = {5.4: (1525, 482), 5.8: (1450, 480), 6.2: (1375, 490), 6.6: (1300, 505),
        9.4: (1415, 505), 9.8: (1440, 498), 10.2: (1540, 493), 10.6: (1580, 470), 11.0: (1600, 473), 11.4: (1600, 468),
        11.8: (1600, 468), 12.2: (1600, 468), 12.6: (1590, 476), 13.0: (1600, 465), 13.4: (1600, 471), 13.8: (1612, 468),
        14.2: (1555, 488), 14.6: (1480, 466), 15.0: (1420, 485), 15.4: (1335, 500),
        18.4: (1390, 492), 18.8: (1440, 495), 19.2: (1515, 470), 19.6: (1610, 465), 20.0: (1660, 465), 20.4: (1722, 452),
        20.8: (1745, 463), 21.1: (1715, 465)}
MANUAL = [(5.4, 6.75), (9.35, 15.6), (18.35, 21.2)]
OCCLUDED = (10.0, 14.4)          # mostly hidden behind the bump: draw the glow softer
kt = sorted(KEYS); kp = to_fld([KEYS[t] for t in kt])
def manual(t):
    i = np.searchsorted(kt, t); i = min(max(i, 1), len(kt) - 1); a, b = kt[i - 1], kt[i]
    w = np.clip((t - a) / (b - a), 0, 1); return kp[i - 1] * (1 - w) + kp[i] * w
T = lambda i: i / 30 + 4.5
N = len(recs)
cap = cv2.VideoCapture(f"{S}/cm/auto30.mp4"); frames = []
while True:
    ok_, f = cap.read()
    if not ok_: break
    frames.append(f)
# Next to the red bump the main detector's wide static mask hides the bumpers. Near each hand-placed position,
# re-fit with a tight static mask so the heading still comes from the bumpers themselves.
def redmask(f):
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    return cv2.inRange(hsv, (0, 120, 70), (7, 255, 255)) | cv2.inRange(hsv, (172, 120, 70), (180, 255, 255))
static = (np.mean(np.stack([redmask(frames[i]) for i in range(F0, F0 + N, 3)]) > 0, axis=0) > 0.45).astype(np.uint8) * 255
static = cv2.dilate(static, np.ones((3, 3), np.uint8))
def refit(i, p):
    m = redmask(frames[i]) & ~static
    ys_, xs_ = np.nonzero(m)
    if not len(xs_): return None
    fp = to_fld(np.stack([xs_, ys_], 1)); sel = fp[np.hypot(fp[:, 0] - p[0], fp[:, 1] - p[1]) < 0.6]
    if len(sel) < 60: return None
    (cx, cy), (w, h), a = cv2.minAreaRect((sel * 100).astype(np.float32))
    if not (55 < max(w, h) < 115 and min(w, h) > 25): return None
    return [cx / 100, cy / 100, a]
xs, ys, an, has = np.zeros(N), np.zeros(N), np.full(N, np.nan), np.zeros(N, bool)
for k in range(N):
    t = T(F0 + k); r = recs[k]; inman = any(a <= t <= b for a, b in MANUAL)
    if inman:
        p = manual(t)
        if r and np.hypot(r[0] - p[0], r[1] - p[1]) < 0.35: xs[k], ys[k], an[k] = r[0], r[1], r[4] % 90
        else:
            q = refit(F0 + k, p)
            if q: xs[k], ys[k], an[k] = 0.5 * (p[0] + q[0]), 0.5 * (p[1] + q[1]), q[2] % 90
            else: xs[k], ys[k] = p
    elif r: xs[k], ys[k], an[k] = r[0], r[1], r[4] % 90
    else: has[k] = True  # fill below
# fill isolated misses by interpolation
ok = ~has; idx = np.arange(N)
xs = np.interp(idx, idx[ok], xs[ok]); ys = np.interp(idx, idx[ok], ys[ok])
ga = ~np.isnan(an); u = np.degrees(np.unwrap(np.radians(an[ga]) * 4) / 4); an = np.interp(idx, idx[ga], u)
def gs(v, s):
    k = np.exp(-0.5 * (np.arange(-3 * s, 3 * s + 1) / s) ** 2); k /= k.sum(); return np.convolve(np.pad(v, 3 * s, mode="edge"), k, "valid")
# angles: drop single-frame outliers (more than 12 deg from the local median), then light smoothing
med = np.array([np.median(an[max(0, j - 4):j + 5]) for j in range(N)]); bad = np.abs(an - med) > 12
an[bad] = med[bad]
xs, ys, an = gs(xs, 3), gs(ys, 3), gs(an, 3)  # light smoothing so the outline turns with the robot
json.dump({"x": xs.tolist(), "y": ys.tolist(), "a": an.tolist()}, open(f"{S}/cm/pose_final.json", "w"))

SIZE, HB = 0.98, 0.15           # just outside the bumpers, and their height, metres
# Hand-measured bumper corners (scripts/champs-clip/corners.json, every 3rd frame: the four bottom outer corners
# of 2638's bumper, in full-frame pixels). When present they drive the box directly; the fitted pose is only a
# fallback for frames nobody annotated.
import os
CORN = None
cp = os.path.join(os.path.dirname(os.path.abspath(__file__)), "corners.json")
if os.path.exists(cp):
    raw = {int(k): v for k, v in json.load(open(cp)).items() if v}
    ks = sorted(raw); arr = [np.array(raw[k]["corners"], np.float32) for k in ks]
    # Where the far corners were guessed (robot behind the bump) they tend to sit too high. A footprint seen from this
    # camera is never more than ~half as tall as it is wide, so squash taller quads toward their bottom edge.
    for j, q in enumerate(arr):
        w = q[:, 0].max() - q[:, 0].min(); h = q[:, 1].max() - q[:, 1].min(); yb = q[:, 1].max()
        if h > 0.5 * w: q[:, 1] = yb - (yb - q[:, 1]) * (0.5 * w / h); arr[j] = q
    # keep corner order consistent across frames (the robot can turn past 45 deg): best cyclic shift / reversal
    for j in range(1, len(arr)):
        prev = arr[j - 1]; best = None
        for cand in [np.roll(arr[j], r, 0) for r in range(4)] + [np.roll(arr[j][::-1], r, 0) for r in range(4)]:
            d = np.abs(cand - prev).sum()
            if best is None or d < best[0]: best = (d, cand)
        arr[j] = best[1]
    allk = np.arange(F0, F0 + N)
    Cs = np.stack([np.stack([np.interp(allk, ks, [a[c, d] for a in arr]) for d in range(2)], -1) for c in range(4)], 1)
    for c in range(4):
        for d in range(2):
            v = Cs[:, c, d]; kk = np.exp(-0.5 * (np.arange(-6, 7) / 2.0) ** 2); kk /= kk.sum()
            Cs[:, c, d] = np.convolve(np.pad(v, 6, mode="edge"), kk, "valid")
    first, last = ks[0], ks[-1]
    CORN = (Cs, first, last)
X0, Y0, W, Hh = 440, 0, 1480, 700
def bumper(k):
    if CORN is not None and CORN[1] <= F0 + k <= CORN[2]:
        q = CORN[0][k]; ctr = q.mean(0); q = ctr + (q - ctr) * 1.06      # wrap just outside the bumpers
        # Band height from the quad itself (bumpers are ~0.15 m on a ~0.9 m robot; vertical is foreshortened by
        # the camera's tilt): the homography's scale isn't trusted here.
        edge = np.mean([np.linalg.norm(q[j] - q[(j + 1) % 4]) for j in range(4) if abs(q[j][0] - q[(j + 1) % 4][0]) > abs(q[j][1] - q[(j + 1) % 4][1])] or [40])
        up = np.array([0, -edge * (HB / 0.9) * 0.85])
        return q, q + up
    c = (xs[k], ys[k])
    # The homography is fitted in mid-field; toward the red wall it overstates the scale (checked by eye against
    # the bumpers), so the box shrinks progressively past image x ≈ 1350.
    ix = to_img([c])[0][0]; corr = 1 - 0.24 * np.clip((ix - 1350) / 350, 0, 1)
    g = cv2.boxPoints(((c[0] * 100, c[1] * 100), (SIZE * corr * 100, SIZE * corr * 100), an[k])) / 100
    gi = to_img(g)
    px_per_m = np.linalg.norm(to_img([[c[0] + 0.5, c[1]]])[0] - to_img([[c[0] - 0.5, c[1]]])[0])
    # The fitted rectangle is where the bumper band itself appears (it was fitted to bumper pixels as if they lay
    # on the floor), so it is the band's middle: put the band's bottom a half-height below it and its top above.
    up = np.array([0, -HB * px_per_m * 0.82])
    return gi - up * 0.55, gi + up * 0.45
GLOW = np.array([255, 170, 77], np.float32) / 255     # #4da3ff in BGR
CORE = np.array([255, 235, 205], np.float32) / 255
ff = subprocess.Popen(["ffmpeg", "-v", "error", "-y", "-f", "rawvideo", "-pix_fmt", "bgr24", "-s", f"{W}x{Hh}", "-r", "30", "-i", "-",
    "-c:v", "libx264", "-preset", "slow", "-crf", "24", "-pix_fmt", "yuv420p", "-movflags", "+faststart", "-an",
    "-colorspace", "bt709", "-color_primaries", "bt709", "-color_trc", "bt709", OUT], stdin=subprocess.PIPE)
end = int(round((21.2 - 4.5) * 30))
for i in range(F0, min(end, F0 + N)):
    k = i - F0; t = T(i)
    img = grade(frames[i][Y0:Y0 + Hh, X0:X0 + W]).astype(np.float32) / 255
    gi, ti = bumper(k); gi = (gi - [X0, Y0]); ti = (ti - [X0, Y0])
    # pulse gently; fade in at the start; softer while hidden behind the bump
    a = (0.85 + 0.15 * np.sin(t * 4.2)) * np.clip((t - 5.7) / 0.5, 0, 1)
    if OCCLUDED[0] < t < OCCLUDED[1]: a *= 0.6
    s = 4  # supersample the line art for smooth edges
    lines = np.zeros((Hh * s // 2, W * s // 2), np.float32)
    def poly(p, w):
        cv2.polylines(lines, [np.round(p * s / 2).astype(np.int32)], True, 1.0, int(w * s / 2), cv2.LINE_AA)
    faces = np.zeros_like(lines)
    for j in range(4):   # the bumper band: each side face as a quad
        q = np.array([gi[j], gi[(j + 1) % 4], ti[(j + 1) % 4], ti[j]])
        cv2.fillPoly(faces, [np.round(q * s / 2).astype(np.int32)], 1.0, cv2.LINE_AA)
    poly(gi, 2.2); poly(ti, 2.2)
    for j in range(4): cv2.line(lines, tuple(np.round(gi[j] * s / 2).astype(int)), tuple(np.round(ti[j] * s / 2).astype(int)), 1.0, int(1.6 * s / 2), cv2.LINE_AA)
    lines = cv2.resize(lines, (W, Hh), interpolation=cv2.INTER_AREA); faces = cv2.resize(faces, (W, Hh), interpolation=cv2.INTER_AREA)
    halo = cv2.GaussianBlur(lines, (0, 0), 9) * 2.2 + cv2.GaussianBlur(lines, (0, 0), 3) * 0.9
    light = (halo[..., None] * GLOW + lines[..., None] * CORE * 0.9 + faces[..., None] * GLOW * 0.16) * a
    out = 1 - (1 - img) * (1 - np.clip(light, 0, 1))      # screen blend
    ff.stdin.write((np.clip(out, 0, 1) * 255).astype(np.uint8).tobytes())
ff.stdin.close(); ff.wait(); print("done", OUT)
