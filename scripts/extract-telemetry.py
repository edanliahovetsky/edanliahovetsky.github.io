#!/usr/bin/env python3
"""Extract what the Agents chapter's AdvantageScope-style replay needs from a real match log.

Source: Rebel Robotics, 2026 FIRST World Championship, Johnson Division, Qualification 91.
Output: assets/media/telemetry-johnson-q91.json
  - time series resampled (sample-and-hold) at RATE Hz
  - "findings": every number the on-page agent reports, computed here from the log

Usage: python3 scripts/extract-telemetry.py [path/to/log.wpilog]
Needs robotpy's wpiutil (`pip install robotpy-wpiutil`).
"""
import json
import math
import statistics as st
import struct
import sys
from pathlib import Path

from wpiutil.log import DataLogReader

LOG = Path(sys.argv[1] if len(sys.argv) > 1 else
           Path.home() / "Downloads/akit_26-05-01_18-20-53_johnson_q91.wpilog")
OUT = Path(__file__).resolve().parent.parent / "assets/media/telemetry-johnson-q91.json"
RATE = 15  # samples per second
T0, T1 = 280.6, 445.4  # log time (s): just before auto enable → end of teleop
AUTO = (280.87, 301.02)
TELEOP = (305.01, 445.08)
BROWNOUT_V = 6.75  # roboRIO 2 default brownout threshold

SCALARS = {
    "flywheel": "/Shooter/FlywheelVelocityRotationsPerSec",
    "flywheelSet": "/RealOutputs/Shooter/shotVelocitySetpointRotationsPerSec",
    "turret": "/Shooter/TurretAngleRotations",
    "turretSet": "/RealOutputs/Shooter/turretProfileSetpointRotations",
    "battery": "/SystemStats/BatteryVoltage",
    "current": "/PowerDistribution/TotalCurrent",
    "crossTrack": "/RealOutputs/FollowPath/crossTrackError",
}
POSE = "/RealOutputs/RobotState/estimatedPose"
VISION = "/RealOutputs/RobotState/vision/visionPose"
MEASURED = "/RealOutputs/SwerveDrive/measuredModuleStates"
SETPOINT = "/RealOutputs/SwerveDrive/optimizedModuleSetpoints"
TAG_IDS = [f"/Vision/Camera{i}/TagIds" for i in range(4)]
# The robot loads the welded 2026 layout first (VisionConstants.java in 2026-Robot-Code).
LAYOUT = Path.home() / "FRC/2026-Robot-Code/src/main/deploy/vision/2026-rebuilt-welded.json"

wanted = set(SCALARS.values()) | {POSE, VISION, MEASURED, SETPOINT, *TAG_IDS}
names, raw = {}, {k: [] for k in wanted}
key_count = 0
for rec in DataLogReader(str(LOG)):
    if rec.isStart():
        key_count += 1
        d = rec.getStartData()
        if d.name in wanted:
            names[d.entry] = (d.name, d.type)
        continue
    if rec.isControl() or rec.getEntry() not in names:
        continue
    name, typ = names[rec.getEntry()]
    t = rec.getTimestamp() / 1e6
    if not (T0 - 5 <= t <= T1):
        continue
    if typ == "double":
        raw[name].append((t, rec.getDouble()))
    elif typ == "struct:Pose2d":
        raw[name].append((t, struct.unpack("<ddd", rec.getRaw())))
    elif typ == "struct:SwerveModuleState[]":
        b = rec.getRaw()  # each state: speed (m/s), angle (rad)
        raw[name].append((t, [struct.unpack_from("<dd", b, i) for i in range(0, len(b), 16)]))
    elif typ == "int64[]":
        raw[name].append((t, list(rec.getIntegerArray())))

N = int((T1 - T0) * RATE) + 1


def resample(series):
    """Sample-and-hold onto the uniform timeline."""
    out, i, last = [], 0, None
    for k in range(N):
        t = T0 + k / RATE
        while i < len(series) and series[i][0] <= t:
            last = series[i][1]
            i += 1
        out.append(last)
    return out


def held(series, t):
    """Most recent value at time t."""
    lo, hi = 0, len(series)
    while lo < hi:
        mid = (lo + hi) // 2
        if series[mid][0] <= t:
            lo = mid + 1
        else:
            hi = mid
    return series[lo - 1][1] if lo else None


r2 = lambda v: None if v is None else round(v, 2)
r3 = lambda v: None if v is None else round(v, 3)
enabled = lambda t: AUTO[0] <= t <= AUTO[1] or TELEOP[0] <= t <= TELEOP[1]

data = {
    "source": "Rebel Robotics, FRC 2638 · 2026 FIRST World Championship · Johnson Division Q91",
    "log": LOG.name,
    "keys": key_count,
    "rate": RATE,
    "auto": [round(AUTO[0] - T0, 2), round(AUTO[1] - T0, 2)],
    "teleop": [round(TELEOP[0] - T0, 2), round(TELEOP[1] - T0, 2)],
    "field": {"image": "assets/media/field26.png", "pxPerM": 200, "marginM": 0.5, "w": 3508, "h": 1814},
}
for key, name in SCALARS.items():
    data[key] = [r3(v) for v in resample(raw[name])]
data["turret"] = [None if v is None else round(v * 360, 1) for v in data["turret"]]
data["turretSet"] = [None if v is None else round(v * 360, 1) for v in data["turretSet"]]
data["crossTrack"] = [v if v is not None and AUTO[0] - T0 <= k / RATE <= AUTO[1] - T0 + 0.5 else None
                      for k, v in enumerate(data["crossTrack"])]
pose = resample(raw[POSE])
data["x"] = [None if p is None else r3(p[0]) for p in pose]
data["y"] = [None if p is None else r3(p[1]) for p in pose]
data["h"] = [None if p is None else r3(p[2]) for p in pose]
# Swerve: per sample, 4 modules × [speed, angle] for measured and setpoint.
for key, name in (("modMeas", MEASURED), ("modSet", SETPOINT)):
    data[key] = [None if s is None else [[r2(v), r2(a)] for v, a in s[:4]] for s in resample(raw[name])]
# Vision: AprilTag IDs each camera currently sees, plus the field layout to place them in 3D.
layout = json.loads(LAYOUT.read_text())
tags = {}
for tg in layout["tags"]:
    tr, q = tg["pose"]["translation"], tg["pose"]["rotation"]["quaternion"]
    yaw = math.atan2(2 * (q["W"] * q["Z"] + q["X"] * q["Y"]), 1 - 2 * (q["Y"] ** 2 + q["Z"] ** 2))
    tags[tg["ID"]] = [r2(tr["x"]), r2(tr["y"]), r2(tr["z"]), r2(yaw)]
data["tags"] = tags
cams = [resample(raw[n]) for n in TAG_IDS]
data["tagsSeen"] = [sorted({i for c in cams if c[k] for i in c[k] if i in tags}) for k in range(N)]
vis, lastT = [], -1
for t, (x, y, _) in raw[VISION]:
    if T0 <= t <= T1 and t - lastT >= 0.2:
        vis.append([round(t - T0, 2), r3(x), r3(y)])
        lastT = t
data["vision"] = vis

# ---- Findings the agent reports (all computed from the log) ----
f = {}
# Localization: distance between each vision fix and the fused pose estimate.
offs = []
for t, (vx, vy, _) in raw[VISION]:
    if enabled(t):
        p = held(raw[POSE], t)
        if p:
            offs.append(math.hypot(vx - p[0], vy - p[1]))
f["visionFixes"] = len(offs)
f["visionOffsetCm"] = round(st.median(offs) * 100, 1)
f["tagsSeen"] = len({i for ids in data["tagsSeen"] for i in ids})
# Drivetrain: how closely each module's speed follows its setpoint while moving.
errs = [[] for _ in range(4)]
for t, sets in raw[SETPOINT]:
    if not enabled(t):
        continue
    meas = held(raw[MEASURED], t)
    if not meas:
        continue
    for m in range(4):
        if abs(sets[m][0]) > 0.5:
            errs[m].append(abs(abs(sets[m][0]) - abs(meas[m][0])))
f["moduleErr"] = [round(st.median(e), 2) for e in errs]  # median |setpoint − measured| speed, m/s
f["worstModule"] = max(range(4), key=lambda m: f["moduleErr"][m])
f["maxModuleSpeed"] = round(max(abs(s[0]) for _, ss in raw[MEASURED] for s in ss[:4]), 2)
# Shooter: time for the flywheel to reach 95% of each new setpoint.
fw, fs = raw[SCALARS["flywheel"]], raw[SCALARS["flywheelSet"]]
spin, prev = [], 0
for t, sp in fs:
    if prev < 5 <= 30 < sp and enabled(t):
        for t2, v in fw:
            if t2 >= t and v >= 0.95 * sp:
                spin.append((t - T0, t2 - t))
                break
    prev = sp
f["spinups"] = len(spin)
f["spinupMedianS"] = round(st.median(d for _, d in spin), 2) if spin else None
f["spinupExampleT"] = round(spin[len(spin) // 2][0], 2) if spin else None
# Power: lowest battery voltage and the current draw at that moment.
bat = [(t, v) for t, v in raw[SCALARS["battery"]] if enabled(t)]
tmin, vmin = min(bat, key=lambda p: p[1])
f["batteryMinV"] = round(vmin, 2)
f["batteryMinT"] = round(tmin - T0, 2)
f["currentAtMinA"] = round(held(raw[SCALARS["current"]], tmin) or 0)
f["peakCurrentA"] = round(max(v for t, v in raw[SCALARS["current"]] if enabled(t)))
f["brownoutMarginV"] = round(vmin - BROWNOUT_V, 2)
# BLine path following during autonomous.
ct = [abs(v) for t, v in raw[SCALARS["crossTrack"]] if AUTO[0] <= t <= AUTO[1]]
f["crossTrackMeanCm"] = round(st.mean(ct) * 100, 1)
data["findings"] = f

OUT.write_text(json.dumps(data, separators=(",", ":")))
print(f"wrote {OUT} ({OUT.stat().st_size // 1024} KB), {N} samples")
print(json.dumps(f, indent=1))
