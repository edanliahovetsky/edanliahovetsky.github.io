import cv2, numpy as np
def grade(bgr):
    f = bgr.astype(np.float32) / 255
    f = np.power(f, 0.78)                                  # lift the dark arena
    f = np.clip((f - 0.5) * 1.12 + 0.52, 0, 1)             # a little contrast and brightness
    hsv = cv2.cvtColor(f, cv2.COLOR_BGR2HSV); hsv[..., 1] = np.clip(hsv[..., 1] * 1.22, 0, 1)
    f = cv2.cvtColor(hsv, cv2.COLOR_HSV2BGR)
    f[..., 0] *= 1.02                                       # a touch cool, to sit with the page
    out = np.clip(f * 255, 0, 255).astype(np.uint8)
    blur = cv2.GaussianBlur(out, (0, 0), 1.2)
    return cv2.addWeighted(out, 1.35, blur, -0.35, 0)        # gentle sharpen
