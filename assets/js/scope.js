// AdvantageScope-style agent session for the Agents chapter.
// Replays real data from assets/media/telemetry-johnson-q91.json (built by scripts/extract-telemetry.py).
// Every number the agent "reports" comes from data.findings, which the extraction script computes from the log.
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js";

const root = document.getElementById("scope");
if (root) init();

function init() {
  const $ = (s, r = root) => r.querySelector(s);
  const $$ = (s, r = root) => Array.from(r.querySelectorAll(s));
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mmss = (s) => { s = Math.max(0, Math.round(s)); return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0"); };
  const COLORS = { blue: "#4da3ff", orange: "#f5a524", green: "#7ee2a8", red: "#ff5f57", purple: "#c084fc", ink: "#eef2f7", muted: "#6f7a8b" };

  // Log fields shown in the sidebar: real key names from the match log.
  const TREE = [
    ["DriverStation", ["Enabled", "Autonomous", "MatchTime"]],
    ["PowerDistribution", ["TotalCurrent", "Voltage", "ChannelCurrent"]],
    ["RealOutputs/FollowPath", ["crossTrackError", "segmentProgress", "rotationErrorDeg"]],
    ["RealOutputs/RobotState", ["estimatedPose", "vision/visionPose"]],
    ["RealOutputs/Shooter", ["shotVelocitySetpointRotationsPerSec", "turretProfileSetpointRotations"]],
    ["RealOutputs/SwerveDrive", ["measuredModuleStates", "optimizedModuleSetpoints", "desiredFieldRelativeSpeeds"]],
    ["Shooter", ["FlywheelVelocityRotationsPerSec", "TurretAngleRotations", "HoodAngleRotations"]],
    ["SwerveDrive", ["module0", "module1", "module2", "module3", "gyro"]],
    ["SystemStats", ["BatteryVoltage", "BatteryCurrent"]],
    ["Vision", ["Camera0/TagIds", "Camera1/TagIds", "Camera2/TagIds", "Camera3/TagIds"]],
  ];

  let D = null, total = 0;
  let t = 0, playTo = null, playSpeed = 1;
  let tab = "field";
  const layers = { trail: false, rays: false, setpoints: false, measured: false };
  let graph = { a: 0, b: 10, keys: [] };
  let callout = null; // { view, html, warn, anchor() }
  let visible = false, started = false, runId = 0;

  // ---------------------------------------------------------------- sidebar tree
  const tree = $("#scope-tree");
  TREE.forEach(([group, leaves]) => {
    const g = document.createElement("li");
    g.className = "group"; g.textContent = group; g.dataset.group = group;
    tree.appendChild(g);
    leaves.forEach((leaf) => {
      const li = document.createElement("li");
      li.className = "leaf"; li.textContent = leaf; li.dataset.key = group + "/" + leaf; li.hidden = true;
      tree.appendChild(li);
    });
  });
  const setGroupOpen = (group, open) => {
    $$(".group", tree).forEach((g) => { if (g.dataset.group === group) g.classList.toggle("expanded", open); });
    $$(".leaf", tree).forEach((l) => { if (l.dataset.key.startsWith(group + "/")) l.hidden = !open; });
  };
  const leafEl = (key) => $$(".leaf", tree).find((l) => l.dataset.key === key);

  // ---------------------------------------------------------------- tabs & views
  const tabs = $$("#scope-tabs button"), views = $$(".view");
  const setTab = (name) => {
    tab = name;
    tabs.forEach((b) => b.classList.toggle("is-on", b.dataset.tab === name));
    views.forEach((v) => v.classList.toggle("is-on", v.dataset.view === name));
  };
  setTab("field");

  // ---------------------------------------------------------------- data helpers
  const idx = (s) => clamp(Math.round(s * D.rate), 0, D.x.length - 1);
  const at = (key, s) => D[key][idx(s)];
  const robotSpeed = (s) => {
    const i = idx(s), j = Math.max(0, i - 3);
    if (i === j || D.x[i] == null || D.x[j] == null) return [0, 0];
    const dt = (i - j) / D.rate;
    return [(D.x[i] - D.x[j]) / dt, (D.y[i] - D.y[j]) / dt];
  };

  // ---------------------------------------------------------------- 3D field (three.js)
  const canvas3d = $("#scope-3d");
  const renderer = new THREE.WebGLRenderer({ canvas: canvas3d, antialias: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.setClearColor(0x070a0f);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x070a0f, 18, 34);
  const camera = new THREE.PerspectiveCamera(40, 16 / 9, 0.1, 100);
  camera.up.set(0, 0, 1);
  scene.add(new THREE.AmbientLight(0xffffff, 0.75));
  const sun = new THREE.DirectionalLight(0xffffff, 1.4); sun.position.set(4, -6, 10); scene.add(sun);

  const fieldGroup = new THREE.Group(); scene.add(fieldGroup);
  const robot = new THREE.Group(); scene.add(robot);
  // Robot: chassis, red bumpers, shooter turret with a barrel.
  const box = (w, d, h, color, z, x = 0, y = 0) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, d, h), new THREE.MeshStandardMaterial({ color, roughness: 0.6, metalness: 0.2 }));
    m.position.set(x, y, z); return m;
  };
  robot.add(box(0.72, 0.72, 0.1, 0x2a313d, 0.1));
  const B = 0.86, T = 0.08, BH = 0.12, BUMPER = 0xd64545;
  robot.add(box(B, T, BH, BUMPER, 0.09, 0, B / 2 - T / 2), box(B, T, BH, BUMPER, 0.09, 0, -B / 2 + T / 2),
    box(T, B, BH, BUMPER, 0.09, B / 2 - T / 2, 0), box(T, B, BH, BUMPER, 0.09, -B / 2 + T / 2, 0));
  const turret = new THREE.Group(); turret.position.set(-0.08, 0, 0.32); robot.add(turret);
  turret.add(box(0.34, 0.34, 0.2, 0x3a4352, 0));
  turret.add(box(0.36, 0.1, 0.1, 0x4da3ff, 0.06, 0.2, 0));
  const nose = new THREE.Mesh(new THREE.ConeGeometry(0.07, 0.18, 12), new THREE.MeshBasicMaterial({ color: 0xeef2f7 }));
  nose.rotation.z = -Math.PI / 2; nose.position.set(0.52, 0, 0.16); robot.add(nose);

  // Trail (last 8 s), auto segment in blue.
  const TRAIL = 8 * 15;
  const trailGeo = new THREE.BufferGeometry();
  trailGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  trailGeo.setAttribute("color", new THREE.BufferAttribute(new Float32Array(TRAIL * 3), 3));
  const trail = new THREE.Line(trailGeo, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.95 }));
  scene.add(trail);
  // Camera-to-AprilTag rays.
  const rayGeo = new THREE.BufferGeometry();
  rayGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(16 * 6), 3));
  const rays = new THREE.LineSegments(rayGeo, new THREE.LineBasicMaterial({ color: 0x7ee2a8, transparent: true, opacity: 0.85 }));
  scene.add(rays);
  const tagMeshes = {};
  let camAngle = -1.2;
  const camTarget = new THREE.Vector3(8.27, 4.03, 0);

  function buildField() {
    const tex = new THREE.TextureLoader().load(D.field.image);
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.anisotropy = 8;
    const w = D.field.w / D.field.pxPerM, h = D.field.h / D.field.pxPerM, m = D.field.marginM;
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ map: tex, color: 0x9aa3b2 }));
    plane.position.set(w / 2 - m, h / 2 - m, 0);
    fieldGroup.add(plane);
    // Field wall outline.
    const L = 16.541, W = 8.069;
    const wall = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(
      [[0, 0], [L, 0], [L, W], [0, W]].map(([x, y]) => new THREE.Vector3(x, y, 0.02))),
      new THREE.LineBasicMaterial({ color: 0x8cc4ff, transparent: true, opacity: 0.6 }));
    fieldGroup.add(wall);
    // AprilTags from the field layout the robot used.
    Object.entries(D.tags).forEach(([id, [x, y, z, yaw]]) => {
      const tag = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.26, 0.26),
        new THREE.MeshBasicMaterial({ color: 0x3b4658 }));
      tag.position.set(x, y, z); tag.rotation.z = yaw;
      fieldGroup.add(tag); tagMeshes[id] = tag;
    });
  }

  function renderField(dt) {
    const i = idx(t), x = D.x[i] ?? 8, y = D.y[i] ?? 4, h = D.h[i] ?? 0;
    robot.position.set(x, y, 0);
    robot.rotation.z = h;
    const tur = D.turret[i];
    turret.rotation.z = tur == null ? 0 : (tur * Math.PI) / 180;
    // Trail
    const pos = trailGeo.attributes.position.array, col = trailGeo.attributes.color.array;
    let n = 0;
    if (layers.trail) {
      for (let k = Math.max(0, i - TRAIL + 1); k <= i; k++) {
        if (D.x[k] == null) continue;
        const ks = k / D.rate, auto = ks >= D.auto[0] && ks <= D.auto[1], fade = 0.25 + 0.75 * (1 - (i - k) / TRAIL);
        pos.set([D.x[k], D.y[k], 0.04], n * 3);
        col.set(auto ? [0.3 * fade, 0.64 * fade, 1 * fade] : [0.93 * fade, 0.95 * fade, 0.97 * fade], n * 3);
        n++;
      }
    }
    trailGeo.setDrawRange(0, n);
    trailGeo.attributes.position.needsUpdate = true; trailGeo.attributes.color.needsUpdate = true;
    // Rays to the tags currently in view
    const seen = layers.rays ? D.tagsSeen[i] || [] : [];
    const rp = rayGeo.attributes.position.array;
    seen.slice(0, 16).forEach((id, k) => {
      const tg = D.tags[id];
      rp.set([x, y, 0.55, tg[0], tg[1], tg[2]], k * 6);
    });
    rayGeo.setDrawRange(0, Math.min(16, seen.length) * 2);
    rayGeo.attributes.position.needsUpdate = true;
    Object.entries(tagMeshes).forEach(([id, m]) => m.material.color.set(seen.includes(+id) ? 0x7ee2a8 : 0x3b4658));
    // Camera: slow orbit around a point between the robot and the field center.
    camAngle += dt * 0.08;
    camTarget.lerp(new THREE.Vector3(x * 0.65 + 8.27 * 0.35, y * 0.65 + 4.03 * 0.35, 0), 0.05);
    camera.position.set(camTarget.x + Math.cos(camAngle) * 8.5, camTarget.y + Math.sin(camAngle) * 8.5, 6.2);
    camera.lookAt(camTarget);
    renderer.render(scene, camera);
  }
  const robotScreen = () => {
    const v = new THREE.Vector3(robot.position.x, robot.position.y, 0.6).project(camera);
    const r = canvas3d.getBoundingClientRect();
    return { x: (v.x + 1) / 2 * r.width, y: (1 - v.y) / 2 * r.height };
  };

  // ---------------------------------------------------------------- 2D canvases
  const fit = (c) => {
    const dpr = Math.min(2, window.devicePixelRatio || 1), r = c.getBoundingClientRect();
    const w = Math.round(r.width * dpr), h = Math.round(r.height * dpr);
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
    return { ctx: c.getContext("2d"), dpr, W: w, H: h };
  };
  const arrow = (ctx, x, y, dx, dy, color, width) => {
    const len = Math.hypot(dx, dy);
    if (len < 2) return;
    ctx.strokeStyle = color; ctx.fillStyle = color; ctx.lineWidth = width;
    ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + dx, y + dy); ctx.stroke();
    const ux = dx / len, uy = dy / len, hs = width * 3.2;
    ctx.beginPath(); ctx.moveTo(x + dx, y + dy);
    ctx.lineTo(x + dx - ux * hs - uy * hs * 0.6, y + dy - uy * hs + ux * hs * 0.6);
    ctx.lineTo(x + dx - ux * hs + uy * hs * 0.6, y + dy - uy * hs - ux * hs * 0.6);
    ctx.fill();
  };

  // Swerve: robot-relative view, front of the robot up. Measured in red, setpoint in blue (AdvantageScope colors).
  const swerveCanvas = $("#scope-swerve");
  const MODULE_POS = [[1, 1], [1, -1], [-1, 1], [-1, -1]]; // module 0..3 at front-left, front-right, back-left, back-right
  let modulePx = [];
  function renderSwerve() {
    const { ctx, dpr, W, H } = fit(swerveCanvas);
    ctx.clearRect(0, 0, W, H);
    const cx = W / 2, cy = H / 2 + 6 * dpr, half = Math.min(W, H) * 0.2;
    // grid
    ctx.strokeStyle = "rgba(170,195,235,0.06)"; ctx.lineWidth = 1;
    for (let g = -6; g <= 6; g++) {
      ctx.beginPath(); ctx.moveTo(cx + g * half / 2, 0); ctx.lineTo(cx + g * half / 2, H); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, cy + g * half / 2); ctx.lineTo(W, cy + g * half / 2); ctx.stroke();
    }
    // chassis
    ctx.strokeStyle = "rgba(214,69,69,0.9)"; ctx.lineWidth = 4 * dpr;
    ctx.strokeRect(cx - half, cy - half, half * 2, half * 2);
    ctx.fillStyle = "rgba(42,49,61,0.55)"; ctx.fillRect(cx - half, cy - half, half * 2, half * 2);
    ctx.fillStyle = COLORS.ink; ctx.beginPath(); ctx.moveTo(cx, cy - half - 14 * dpr); ctx.lineTo(cx - 8 * dpr, cy - half - 2 * dpr); ctx.lineTo(cx + 8 * dpr, cy - half - 2 * dpr); ctx.fill();
    const i = idx(t), meas = D.modMeas[i], set = D.modSet[i], scale = half * 1.15 / 5;
    modulePx = [];
    MODULE_POS.forEach(([fx, fy], m) => {
      const mx = cx - fy * half * 0.78, my = cy - fx * half * 0.78;
      modulePx.push({ x: mx / dpr, y: my / dpr });
      ctx.strokeStyle = "rgba(238,242,247,0.35)"; ctx.lineWidth = 1.5 * dpr;
      ctx.beginPath(); ctx.arc(mx, my, 16 * dpr, 0, Math.PI * 2); ctx.stroke();
      const vec = (s) => { const [v, a] = s; return [-Math.sin(a) * v * scale, -Math.cos(a) * v * scale]; };
      if (layers.setpoints && set) { const [dx, dy] = vec(set[m]); arrow(ctx, mx, my, dx, dy, COLORS.blue, 3 * dpr); }
      if (layers.measured && meas) { const [dx, dy] = vec(meas[m]); arrow(ctx, mx, my, dx, dy, COLORS.red, 3 * dpr); }
      ctx.fillStyle = COLORS.muted; ctx.font = `500 ${11 * dpr}px "JetBrains Mono", monospace`;
      ctx.fillText("module " + m, mx - 26 * dpr, my + (fx > 0 ? -26 : 36) * dpr);
    });
    // chassis velocity (field → robot frame)
    const [vx, vy] = robotSpeed(t), h = D.h[i] ?? 0;
    const rx = vx * Math.cos(-h) - vy * Math.sin(-h), ry = vx * Math.sin(-h) + vy * Math.cos(-h);
    arrow(ctx, cx, cy, -ry * scale, -rx * scale, COLORS.green, 3 * dpr);
    // legend
    ctx.font = `500 ${11.5 * dpr}px "JetBrains Mono", monospace`;
    const legend = [["measured", COLORS.red, layers.measured], ["setpoint", COLORS.blue, layers.setpoints], ["chassis", COLORS.green, true]];
    legend.filter((l) => l[2]).forEach(([name, color], k) => {
      ctx.fillStyle = color; ctx.fillRect(14 * dpr, (16 + k * 18) * dpr, 12 * dpr, 3 * dpr);
      ctx.fillStyle = "rgba(174,184,199,0.9)"; ctx.fillText(name, 32 * dpr, (21 + k * 18) * dpr);
    });
    ctx.fillStyle = "rgba(174,184,199,0.9)";
    ctx.fillText(Math.hypot(vx, vy).toFixed(2) + " m/s", W - 96 * dpr, 21 * dpr);
  }

  // Line graph: AdvantageScope-like, fixed window with a moving playhead.
  const graphCanvas = $("#scope-graph"), legendEl = $("#scope-legend");
  const PAD = { l: 52, r: 52, t: 70, b: 28 };
  const gx = (s, W, dpr) => (PAD.l + (s - graph.a) / (graph.b - graph.a) * (W / dpr - PAD.l - PAD.r)) * dpr;
  const gy = (v, range, H, dpr) => (PAD.t + (1 - (v - range[0]) / (range[1] - range[0])) * (H / dpr - PAD.t - PAD.b)) * dpr;
  function renderGraph() {
    const { ctx, dpr, W, H } = fit(graphCanvas);
    ctx.clearRect(0, 0, W, H);
    ctx.font = `400 ${10.5 * dpr}px "JetBrains Mono", monospace`;
    ctx.strokeStyle = "rgba(170,195,235,0.08)"; ctx.fillStyle = "rgba(111,122,139,0.95)"; ctx.lineWidth = 1;
    const left = graph.keys.find((k) => k.axis !== "R"), right = graph.keys.find((k) => k.axis === "R");
    for (let g = 0; g <= 4; g++) {
      const y = (PAD.t + g / 4 * (H / dpr - PAD.t - PAD.b)) * dpr;
      ctx.beginPath(); ctx.moveTo(PAD.l * dpr, y); ctx.lineTo(W - PAD.r * dpr, y); ctx.stroke();
      if (left) ctx.fillText((left.range[1] - g / 4 * (left.range[1] - left.range[0])).toFixed(0), 8 * dpr, y + 4 * dpr);
      if (right) ctx.fillText((right.range[1] - g / 4 * (right.range[1] - right.range[0])).toFixed(0), W - (PAD.r - 8) * dpr, y + 4 * dpr);
    }
    const step = Math.max(1, Math.round((graph.b - graph.a) / 6));
    for (let s = Math.ceil(graph.a); s <= graph.b; s += step) {
      const x = gx(s, W, dpr);
      ctx.beginPath(); ctx.moveTo(x, PAD.t * dpr); ctx.lineTo(x, H - PAD.b * dpr); ctx.stroke();
      ctx.fillText(s.toFixed(0) + "s", x - 8 * dpr, H - 8 * dpr);
    }
    const until = Math.min(t, graph.b);
    graph.keys.forEach((k) => {
      ctx.strokeStyle = k.color; ctx.lineWidth = 2 * dpr; ctx.beginPath();
      let pen = false;
      for (let i = idx(graph.a); i <= idx(until); i++) {
        const v = D[k.data][i];
        if (v == null) { pen = false; continue; }
        const x = gx(i / D.rate, W, dpr), y = gy(clamp(v, k.range[0], k.range[1]), k.range, H, dpr);
        if (pen) ctx.lineTo(x, y); else { ctx.moveTo(x, y); pen = true; }
      }
      ctx.stroke();
    });
    if (t >= graph.a && t <= graph.b) {
      const x = gx(t, W, dpr);
      ctx.strokeStyle = "rgba(238,242,247,0.5)"; ctx.lineWidth = 1 * dpr;
      ctx.beginPath(); ctx.moveTo(x, PAD.t * dpr); ctx.lineTo(x, H - PAD.b * dpr); ctx.stroke();
    }
  }
  const graphPoint = (s, v, key) => {
    const r = graphCanvas.getBoundingClientRect(), k = graph.keys.find((g) => g.data === key);
    return {
      x: PAD.l + (s - graph.a) / (graph.b - graph.a) * (r.width - PAD.l - PAD.r),
      y: PAD.t + (1 - (v - k.range[0]) / (k.range[1] - k.range[0])) * (r.height - PAD.t - PAD.b),
    };
  };
  const addLegend = (k) => {
    const s = document.createElement("span");
    s.innerHTML = `<i style="background:${k.color}"></i>${k.label}`;
    legendEl.appendChild(s);
  };

  // ---------------------------------------------------------------- HUD: timeline, mode, clock, callout
  const head = $("#scope-head"), modeEl = $("#scope-mode"), clockEl = $("#scope-clock"), calloutEl = $("#scope-callout");
  function renderHud() {
    head.style.left = (t / total * 100) + "%";
    const auto = t >= D.auto[0] && t <= D.auto[1], tele = t >= D.teleop[0] && t <= D.teleop[1];
    modeEl.textContent = auto ? "AUTO" : tele ? "TELEOP" : "DISABLED";
    modeEl.className = "mode" + (auto ? " auto" : tele ? " teleop" : "");
    clockEl.textContent = auto ? mmss(20 - (t - D.auto[0])) : tele ? mmss(140 - (t - D.teleop[0])) : "0:00";
    if (callout && callout.view === tab) {
      const p = callout.anchor(), vr = $("#scope-view").getBoundingClientRect();
      const w = calloutEl.offsetWidth, h = calloutEl.offsetHeight;
      calloutEl.style.left = clamp(p.x + 16, 8, vr.width - w - 8) + "px";
      calloutEl.style.top = clamp(p.y - h - 14, 8, vr.height - h - 8) + "px";
      calloutEl.classList.add("is-on");
    } else calloutEl.classList.remove("is-on");
  }
  const showCallout = (view, html, anchor, warn) => {
    callout = { view, anchor };
    calloutEl.innerHTML = html;
    calloutEl.classList.toggle("warn", !!warn);
  };

  // ---------------------------------------------------------------- render loop
  let last = 0;
  function frame(now) {
    const dt = last ? Math.min(0.1, (now - last) / 1000) : 0.016;
    last = now;
    if (visible && D) {
      if (playTo != null) { t = Math.min(playTo, t + dt * playSpeed); if (t >= playTo) playTo = null; }
      if (tab === "field") renderField(dt);
      else if (tab === "swerve") renderSwerve();
      else renderGraph();
      renderHud();
    }
    requestAnimationFrame(frame);
  }
  const resize = () => {
    const r = canvas3d.getBoundingClientRect();
    if (!r.width) return;
    renderer.setSize(r.width, r.height, false);
    camera.aspect = r.width / r.height; camera.updateProjectionMatrix();
  };
  new ResizeObserver(resize).observe($("#scope-view"));

  // ---------------------------------------------------------------- agent: cursor, messages, script
  const log = $("#agent-log"), cursor = $("#scope-cursor");
  const ABORT = Symbol("abort");
  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function wait(ms, run) {
    let left = ms;
    while (left > 0) {
      if (run !== runId) throw ABORT;
      await sleep(50);
      if (visible) left -= 50;
    }
    if (run !== runId) throw ABORT;
  }
  const visibleEl = (el) => el && el.offsetParent !== null && getComputedStyle(cursor).display !== "none";
  async function moveTo(el, run) {
    if (!visibleEl(el)) return;
    const rr = root.getBoundingClientRect(), r = el.getBoundingClientRect();
    cursor.style.transform = `translate(${r.left - rr.left + Math.min(28, r.width / 2)}px, ${r.top - rr.top + r.height / 2}px)`;
    await wait(750, run);
    cursor.classList.remove("click"); void cursor.offsetWidth; cursor.classList.add("click");
    await wait(220, run);
  }
  const post = (cls, html) => {
    const m = document.createElement("div");
    m.className = "msg " + cls; m.innerHTML = html;
    log.appendChild(m);
    while (log.children.length > 5) log.removeChild(log.firstChild);
    return m;
  };
  async function think(text, run) {
    const m = post("think", "");
    for (let i = 1; i <= text.length; i += 2) { m.textContent = text.slice(0, i); await wait(14, run); }
    m.textContent = text;
    await wait(350, run);
  }
  async function tool(cmd, out, run, ms = 900) {
    const m = post("tool", `<div class="cmd"></div><div class="out pending">running</div>`);
    m.querySelector(".cmd").textContent = "wpilib-agent-tools " + cmd;
    await wait(ms, run);
    const o = m.querySelector(".out");
    o.classList.remove("pending"); o.textContent = out;
    await wait(500, run);
  }
  const action = (text) => post("action", text);
  const finding = (text, warn) => post("finding" + (warn ? " warn" : ""), text);
  async function openTab(name, run) {
    const b = tabs.find((x) => x.dataset.tab === name);
    await moveTo(b, run);
    setTab(name);
    await wait(300, run);
  }
  async function addKey(key, run) {
    const group = TREE.find(([g]) => key.startsWith(g + "/"))[0];
    setGroupOpen(group, true);
    const el = leafEl(key);
    await moveTo(el, run);
    if (el) { el.classList.add("hot"); setTimeout(() => el.classList.remove("hot"), 2200); }
    await wait(250, run);
  }
  const playRange = (a, b, speed) => { t = a; playTo = b; playSpeed = speed; };

  // A busy 8 s teleop window for the swerve view: highest mean module speed.
  const busyWindow = () => {
    let best = D.teleop[0], bestV = -1;
    for (let s = D.teleop[0]; s < D.teleop[1] - 8; s += 1) {
      let sum = 0;
      for (let k = idx(s); k < idx(s + 8); k++) { const m = D.modMeas[k]; if (m) sum += m.reduce((a, q) => a + Math.abs(q[0]), 0); }
      if (sum > bestV) { bestV = sum; best = s; }
    }
    return best;
  };

  const F = () => D.findings;
  const SCENES = [
    { name: "Open log", run: async (r) => {
      setTab("field"); t = D.auto[0] - 0.4; playTo = null;
      await think("Opening our robot's log from a Worlds match.", r);
      await tool("logs --summary", `${D.log}\n${D.keys} fields · auto 0:20 · teleop 2:20`, r, 1100);
      for (const [g] of TREE) { setGroupOpen(g, true); await wait(90, r); setGroupOpen(g, false); }
    } },
    { name: "Localize", run: async (r) => {
      await think("Localization: do vision and odometry agree?", r);
      await addKey("RealOutputs/RobotState/estimatedPose", r); layers.trail = true;
      await addKey("Vision/Camera1/TagIds", r); layers.rays = true;
      action("Replaying auto");
      playRange(D.auto[0], D.auto[1], 2.2);
      await tool("query --mode stats --key /RealOutputs/RobotState/vision/visionPose",
        `${F().visionFixes.toLocaleString()} vision fixes · ${F().tagsSeen} AprilTags\nmedian offset from fused pose: ${F().visionOffsetCm} cm`, r, 1400);
      showCallout("field", `<b>Vision ↔ odometry</b><br>agree within ${F().visionOffsetCm} cm`, robotScreen);
      finding(`Localization healthy: ${F().visionOffsetCm} cm median offset.`);
      await wait(1400, r);
      await tool("query --mode stats --key /RealOutputs/FollowPath/crossTrackError",
        `BLine path following, auto: ${F().crossTrackMeanCm} cm mean cross-track error`, r, 1100);
      await wait(1800, r); callout = null;
    } },
    { name: "Drivetrain", run: async (r) => {
      await think("Drivetrain: are all four modules tracking?", r);
      await openTab("swerve", r);
      await addKey("RealOutputs/SwerveDrive/measuredModuleStates", r); layers.measured = true;
      await addKey("RealOutputs/SwerveDrive/optimizedModuleSetpoints", r); layers.setpoints = true;
      const s0 = busyWindow();
      action("Jumping to heavy driving");
      playRange(s0, s0 + 8, 1);
      const e = F().moduleErr;
      await tool("query --mode stats --key /RealOutputs/SwerveDrive/measuredModuleStates",
        "median |setpoint − measured| speed\n" + e.map((v, m) => `  module ${m}   ${v.toFixed(2)} m/s`).join("\n"), r, 1500);
      const w = F().worstModule;
      showCallout("swerve", `<b>Module ${w}</b> trails its setpoint most<br>${e[w].toFixed(2)} m/s median`, () => modulePx[w] || { x: 0, y: 0 }, true);
      finding(`Module ${w} lags its setpoint. Check its feedforward.`, true);
      await wait(3600, r); callout = null;
    } },
    { name: "Shooter", run: async (r) => {
      await think("Shooter: how fast does the flywheel recover?", r);
      await openTab("graph", r);
      const ex = F().spinupExampleT;
      graph = { a: ex - 3, b: ex + 5, keys: [] }; legendEl.innerHTML = "";
      t = graph.a; playTo = null;
      for (const k of [
        { key: "Shooter/FlywheelVelocityRotationsPerSec", data: "flywheel", label: "Flywheel velocity (rot/s)", color: COLORS.blue, range: [-5, 75] },
        { key: "RealOutputs/Shooter/shotVelocitySetpointRotationsPerSec", data: "flywheelSet", label: "Setpoint (rot/s)", color: COLORS.orange, range: [-5, 75] },
      ]) { await addKey(k.key, r); graph.keys.push(k); addLegend(k); }
      playRange(graph.a, graph.b, 1.4);
      await tool("query --mode stats --key /Shooter/FlywheelVelocityRotationsPerSec",
        `${F().spinups} spin-ups · median ${F().spinupMedianS} s to 95% of setpoint`, r, 1300);
      const sp = ex + F().spinupMedianS;
      showCallout("graph", `<b>${F().spinupMedianS} s</b> median spin-up`, () => graphPoint(sp, at("flywheelSet", sp) || 60, "flywheel"));
      finding(`Flywheel recovers in ${F().spinupMedianS} s. No change needed.`);
      await wait(3000, r); callout = null;
    } },
    { name: "Power", run: async (r) => {
      await think("Power: any brownout risk?", r);
      const m = F().batteryMinT;
      graph = { a: m - 5, b: m + 3, keys: [] }; legendEl.innerHTML = "";
      t = graph.a; playTo = null;
      for (const k of [
        { key: "SystemStats/BatteryVoltage", data: "battery", label: "Battery (V)", color: COLORS.blue, range: [6, 14] },
        { key: "PowerDistribution/TotalCurrent", data: "current", label: "Total current (A)", color: COLORS.green, range: [0, 280], axis: "R" },
      ]) { await addKey(k.key, r); graph.keys.push(k); addLegend(k); }
      playRange(graph.a, graph.b, 1.4);
      await tool("query --mode stats --key /SystemStats/BatteryVoltage",
        `min ${F().batteryMinV} V at ${F().currentAtMinA} A · peak draw ${F().peakCurrentA} A\nbrownout threshold 6.75 V`, r, 1300);
      showCallout("graph", `<b>${F().batteryMinV} V</b> at ${F().currentAtMinA} A<br>${F().brownoutMarginV} V above brownout`, () => graphPoint(m, F().batteryMinV, "battery"));
      finding(`No brownout risk: ${F().brownoutMarginV} V of margin.`);
      await wait(3000, r); callout = null;
    } },
    { name: "Act", run: async (r) => {
      await think(`Fix: test module ${F().worstModule}'s feedforward in simulation first.`, r);
      await tool(`sandbox create --name module${F().worstModule}_ff --source workspace`, `✓ sandbox module${F().worstModule}_ff created`, r, 1000);
      action(`Editing module ${F().worstModule} feedforward`);
      await wait(900, r);
      await tool(`sandbox run --name module${F().worstModule}_ff -- record --address localhost --duration 15`, "✓ simulation recorded → agent/logs/run.wpilog", r, 1600);
      await tool(`sandbox patch --name module${F().worstModule}_ff --output module${F().worstModule}_ff.diff`, "✓ patch and data ready for human review", r, 1000);
      await wait(3200, r);
    } },
  ];

  // Step pills: jump to any scene.
  const pillsEl = $("#agent-steps");
  const pills = SCENES.map((s, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = s.name;
    b.addEventListener("click", () => start(i));
    pillsEl.appendChild(b);
    return b;
  });

  function reset() {
    log.innerHTML = ""; legendEl.innerHTML = "";
    layers.trail = layers.rays = layers.setpoints = layers.measured = false;
    callout = null; playTo = null;
    TREE.forEach(([g]) => setGroupOpen(g, false));
  }
  async function start(from = 0) {
    const run = ++runId;
    reset();
    // Scenes after the first assume earlier layers are on.
    if (from > 1) { layers.trail = layers.rays = true; }
    if (from > 2) { layers.measured = layers.setpoints = true; }
    try {
      for (let i = from; ; i = (i + 1) % SCENES.length) {
        if (i === 0 && run === runId && log.children.length) reset();
        pills.forEach((p, k) => p.classList.toggle("is-on", k === i));
        await SCENES[i].run(run);
      }
    } catch (e) { if (e !== ABORT) console.error(e); }
  }

  // ---------------------------------------------------------------- boot: build ahead of time, play when visible
  // Loading the log and building the 3D field takes a moment, so it happens while the reader is still about a
  // screen and a half above (in idle time), not the instant the window scrolls into view.
  const seg = (el, a, b) => { el.style.left = (a / total * 100) + "%"; el.style.width = ((b - a) / total * 100) + "%"; };
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 1));
  let built = null;
  const build = () => (built ||= fetch("assets/media/telemetry-johnson-q91.json").then((r) => r.json()).then((data) => new Promise((res) => idle(() => {
    D = data; total = D.x.length / D.rate;
    $("#scope-title").textContent = "AdvantageScope — " + D.log;
    seg($("#seg-auto"), D.auto[0], D.auto[1]); seg($("#seg-teleop"), D.teleop[0], D.teleop[1]);
    buildField(); resize();
    res();
  }, { timeout: 1500 }))));
  new IntersectionObserver((entries) => { if (entries[0].isIntersecting) build(); }, { rootMargin: "150% 0px" }).observe(root);
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible && !started) { started = true; build().then(() => start(0)); }
  }, { threshold: 0.2 }).observe(root);
  requestAnimationFrame(frame);
}
