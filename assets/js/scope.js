// Agents chapter: plays a recording of the AdvantageScope-style session (built by scripts/capture/scope.mjs and
// scripts/build-scope.py from the live renderer in scope-live.js), so visitors' machines decode one small video
// instead of running three.js and the telemetry replay.
//   - The views (tabs, 3D field / swerve / graph, timeline) are the video, recorded at desktop and phone layouts.
//   - The agent log is real HTML, rebuilt from the recorded message timeline at the video's current time, so it stays
//     sharp and in step with the video, including after a jump.
//   - The step pills jump to a scene. The video plays only while the session is on screen.
// ?scope-live runs the live renderer instead (used by the capture).
const root = document.getElementById("scope");
if (root && new URLSearchParams(location.search).has("scope-live")) import("./scope-live.js");
else if (root) init();

function init() {
  const $ = (s) => root.querySelector(s);
  const media = window.Media || { tier: "hd", reduceMotion: false };
  const phone = () => matchMedia("(max-width: 760px)").matches;
  const NAMES = ["Open log", "Localize", "Drivetrain", "Shooter", "Power", "Act"];
  root.classList.add("is-recorded");

  // The views become one video in .scope-main; the cursor was recorded into it.
  const main = $(".scope-main");
  const video = document.createElement("video");
  video.className = "scope-video"; video.muted = true; video.loop = true; video.playsInline = true;
  video.setAttribute("playsinline", ""); video.setAttribute("muted", ""); video.preload = "none";
  video.setAttribute("aria-hidden", "true");
  main.replaceChildren(video);
  const log = $("#agent-log"), pillsEl = $("#agent-steps");

  let data = null, L = null, layoutName = "", visible = false, started = false;
  const pills = NAMES.map((name, i) => {
    const b = document.createElement("button");
    b.type = "button"; b.textContent = name;
    b.addEventListener("click", () => { if (L) { video.currentTime = L.sceneStart[i] / 1000; play(); sync(true); } });
    pillsEl.appendChild(b);
    return b;
  });

  // Picks the recording for the current layout (phone or desktop) and size.
  function pick() {
    const name = phone() ? "phone" : "desktop";
    if (name === layoutName) return;
    layoutName = name; L = data[name];
    const at = video.currentTime;
    video.poster = `assets/media/scope/${name}-poster.webp`;
    video.style.aspectRatio = `${L.size[0]} / ${L.size[1]}`;
    video.src = `assets/media/scope/${name}${media.tier === "sd" && name === "desktop" ? "-sd" : ""}.mp4`;
    if (started) { video.currentTime = at; play(); }
    shown = null;
  }
  const play = () => { if (visible && !media.reduceMotion) { const p = video.play(); p && p.catch(() => {}); } };

  // ---------------------------------------------------------------- agent log, rebuilt from the timeline
  const esc = (s) => s.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
  /** The messages on screen at time ms: the last five posted since the loop's last reset, in their state then. */
  function state(ms) {
    const msgs = []; let scene = 0;
    for (const e of L.events) {
      if (e.t > ms) break;
      if (e.k === "reset") msgs.length = 0;
      else if (e.k === "scene") scene = e.i;
      else msgs.push(e);
    }
    return { scene, msgs: msgs.slice(-5) };
  }
  function html(e, ms) {
    const dt = ms - e.t;
    if (e.k === "think") return `<div class="msg think">${esc(e.text.slice(0, Math.min(e.text.length, 1 + 2 * Math.floor(dt / 14))))}</div>`;
    if (e.k === "tool") {
      const done = dt >= e.dur;
      return `<div class="msg tool"><div class="cmd">${esc(e.cmd)}</div><div class="out${done ? "" : " pending"}">${done ? esc(e.out) : "running"}</div></div>`;
    }
    if (e.k === "action") return `<div class="msg action">${esc(e.text)}</div>`;
    return `<div class="msg finding${e.warn ? " warn" : ""}">${esc(e.text)}</div>`;
  }
  let shown = null, sceneOn = -1;
  function sync(jump) {
    if (!L) return;
    const ms = video.currentTime * 1000, s = state(ms);
    const out = s.msgs.map((e) => html(e, ms)), key = out.join("");
    if (key !== shown) {
      // Messages are added one at a time as the video plays; a jump redraws the log without the entrance animation.
      const prev = shown ? shown.length : 0;
      log.classList.toggle("no-anim", !!jump || out.length === 0 || key.length < prev);
      log.innerHTML = key; shown = key;
    }
    if (s.scene !== sceneOn) { sceneOn = s.scene; pills.forEach((p, k) => p.classList.toggle("is-on", k === s.scene)); }
  }
  let raf = 0;
  const loop = () => { sync(false); raf = visible && !video.paused ? requestAnimationFrame(loop) : 0; };
  video.addEventListener("play", () => { if (!raf) raf = requestAnimationFrame(loop); });
  video.addEventListener("seeked", () => sync(true));
  video.addEventListener("timeupdate", () => { if (!raf) sync(false); });

  // ---------------------------------------------------------------- boot: load near, play while visible
  let loading = null;
  const boot = () => (loading ||= fetch("assets/media/scope/scope.json").then((r) => r.json()).then((d) => {
    data = d;
    $("#scope-title").textContent = d.title;
    // Each scene's start, from the timeline, for the step pills.
    for (const name of ["desktop", "phone"]) d[name].sceneStart = NAMES.map((_, i) => (d[name].events.find((e) => e.k === "scene" && e.i === i) || { t: 0 }).t);
    pick();
    matchMedia("(max-width: 760px)").addEventListener("change", pick);
  }));
  new IntersectionObserver((entries) => { if (entries[0].isIntersecting) boot().then(() => { video.preload = "auto"; }); }, { rootMargin: "100% 0px" }).observe(root);
  new IntersectionObserver((entries) => {
    visible = entries[0].isIntersecting;
    if (visible) boot().then(() => { started = true; play(); sync(true); });
    else video.pause();
  }, { threshold: 0.2 }).observe(root);
}
