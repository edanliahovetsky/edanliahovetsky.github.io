import cv2, numpy as np, json, sys
S = sys.argv[1]
H = np.array(json.load(open(f"{S}/cm/H.json"))["H"]); Hi = np.linalg.inv(H)
cap = cv2.VideoCapture(f"{S}/cm/auto30.mp4"); frames = []
while True:
    ok, f = cap.read()
    if not ok: break
    frames.append(f)
F0, F1 = 27, 500                     # t = 5.4 .. 21.17
def redmask(f):
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV)
    m = cv2.inRange(hsv, (0, 120, 70), (7, 255, 255)) | cv2.inRange(hsv, (172, 120, 70), (180, 255, 255))
    m[:240] = 0; m[680:] = 0
    return m
masks = [redmask(frames[i]) for i in range(F0, len(frames))]
static = (np.mean(np.stack(masks[::3]) > 0, axis=0) > 0.45).astype(np.uint8) * 255
static = cv2.dilate(static, np.ones((7, 7), np.uint8))
cv2.imwrite(f"{S}/cm/static.png", static)
def to_field(pts): return cv2.perspectiveTransform(pts.reshape(-1, 1, 2).astype(np.float32), Hi).reshape(-1, 2)
def to_img(pts): return cv2.perspectiveTransform(np.asarray(pts, np.float32).reshape(-1, 1, 2), H).reshape(-1, 2)
pos = to_field(np.array([[1430, 478]]))[0]   # 2638's start, in field metres
out = []
for i in range(F0, F1):
    m = masks[i - F0] & ~static
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((3, 3), np.uint8))
    ys, xs = np.nonzero(m)
    rec = None
    if len(xs):
        fp = to_field(np.stack([xs, ys], 1))
        d = np.hypot(fp[:, 0] - pos[0], fp[:, 1] - pos[1])
        sel = fp[d < 0.85]
        if len(sel) > 80:
            r = cv2.minAreaRect((sel * 100).astype(np.float32))
            (cx, cy), (w, h), a = r
            if 45 < max(w, h) < 125:
                rec = [cx / 100, cy / 100, w / 100, h / 100, a, len(sel)]
                pos = 0.6 * pos + 0.4 * np.array([cx / 100, cy / 100])
    out.append(rec)
json.dump({"F0": F0, "recs": out}, open(f"{S}/cm/recs.json", "w"))
ok = sum(r is not None for r in out); print("detected", ok, "/", len(out))
# check sheet: draw detected footprint every 15 frames
tiles = []
for i in range(F0, F1, 15):
    v = frames[i].copy(); r = out[i - F0]
    if r:
        box = cv2.boxPoints(((r[0] * 100, r[1] * 100), (r[2] * 100, r[3] * 100), r[4])) / 100
        cv2.polylines(v, [to_img(box).astype(int)], True, (255, 200, 0), 2)
    t = cv2.resize(v[200:680, 700:1920], (610, 240)); cv2.putText(t, f"{i/30+4.5:.1f}", (5, 20), 0, 0.6, (255, 255, 255), 2); tiles.append(t)
while len(tiles) % 4: tiles.append(np.zeros_like(tiles[0]))
cv2.imwrite(f"{S}/cm/recs.jpg", np.vstack([np.hstack(tiles[k:k + 4]) for k in range(0, len(tiles), 4)]))
