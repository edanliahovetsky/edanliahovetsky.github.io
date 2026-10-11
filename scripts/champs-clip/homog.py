import cv2, numpy as np, json, sys
S = sys.argv[1]
cap = cv2.VideoCapture(f"{S}/cm/auto30.mp4"); cap.set(cv2.CAP_PROP_POS_FRAMES, 30); ok, fr = cap.read()
hsv = cv2.cvtColor(fr, cv2.COLOR_BGR2HSV)
m = cv2.inRange(hsv, (20, 120, 120), (35, 255, 255))
m[:250] = 0; m[640:] = 0; m[:, :780] = 0; m[:, 1150:] = 0
m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((15, 15), np.uint8))
n, lab, st, _ = cv2.connectedComponentsWithStats(m)
k = 1 + np.argmax(st[1:, cv2.CC_STAT_AREA]); blob = (lab == k).astype(np.uint8)
cnt = cv2.findContours(blob, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[0][0]
hull = cv2.convexHull(cnt)
eps = 2
while True:
    q = cv2.approxPolyDP(hull, eps, True)
    if len(q) <= 4: break
    eps += 1
q = q.reshape(-1, 2).astype(np.float32)
# order: far-left, far-right, near-right, near-left (image: top = far)
q = q[np.argsort(q[:, 1])]; top = q[:2][np.argsort(q[:2, 0])]; bot = q[2:][np.argsort(q[2:, 0])]
img = np.array([top[0], top[1], bot[1], bot[0]], np.float32)
# field: camera on the y=0 side; far edge is y=6.35. x increases to the right (blue wall at x=0 on the left).
fld = np.array([[7.35, 6.35], [9.18, 6.35], [9.18, 1.73], [7.35, 1.73]], np.float32)
print("img corners", img.round(1).tolist())
H = cv2.getPerspectiveTransform(fld, img)
json.dump({"H": H.tolist()}, open(f"{S}/cm/H.json", "w"))
# top-down warp at 60 px/m over x 3..17, y -0.5..8.6
s = 60; T = np.array([[1 / s, 0, 3], [0, -1 / s, 8.6], [0, 0, 1]])
td = cv2.warpPerspective(fr, H @ T, (int(14 * s), int(9.1 * s)))
cv2.imwrite(f"{S}/cm/topdown.jpg", td)
v = fr.copy(); cv2.polylines(v, [img.astype(int)], True, (0, 255, 255), 2)
for x in np.arange(3, 17.1, 1):
    pts = np.array([[[x, y]] for y in np.arange(-0.5, 8.6, 0.1)], np.float32)
    cv2.polylines(v, [cv2.perspectiveTransform(pts, H).astype(int)], False, (255, 255, 0), 1)
for y in np.arange(0, 8.1, 1):
    pts = np.array([[[x, y]] for x in np.arange(3, 17, 0.1)], np.float32)
    cv2.polylines(v, [cv2.perspectiveTransform(pts, H).astype(int)], False, (255, 0, 255), 1)
cv2.imwrite(f"{S}/cm/gridover.jpg", v[0:720])
