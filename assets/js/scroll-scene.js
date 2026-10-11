// Shared engine for Apple-style scroll scenes. A scene pins its stage while you scroll past it, and scroll position
// maps to a position t on the scene's timeline. Everything on screen is a pure function of t (render(t)), so
// scrolling backward rewinds exactly. Pinning and scrub smoothing use GSAP ScrollTrigger (loaded globally).

export const clamp = (v, a = 0, b = 1) => Math.max(a, Math.min(b, v));
export const lerp = (a, b, x) => a + (b - a) * x;
export const smooth = (a, b, x) => { x = clamp((x - a) / (b - a)); return x * x * (3 - 2 * x); };
export const easeOut = (x) => 1 - Math.pow(1 - clamp(x), 3);
export const easeInOut = (x) => { x = clamp(x); return x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2; };
/** Visible in the middle of 0..1, fading in and out over `edge` at each end. */
export const win = (p, edge = 0.15, edgeOut = edge) => Math.min(smooth(0, edge, p), 1 - smooth(1 - edgeOut, 1, p));

/** Interpolates keyframes [[p, {k: v}], …] with ease-in-out between neighbours; keys carry forward. */
export function keyframes(p, keys) {
  const filled = []; let last = {};
  for (const [at, v] of keys) { last = { ...last, ...v }; filled.push([at, last]); }
  if (p <= filled[0][0]) return { ...filled[0][1] };
  for (let i = 1; i < filled.length; i++) {
    const [a, va] = filled[i - 1], [b, vb] = filled[i];
    if (p <= b) {
      const x = easeInOut((p - a) / (b - a)), out = {};
      for (const k in vb) out[k] = lerp(va[k] ?? vb[k], vb[k], x);
      return out;
    }
  }
  return { ...filled[filled.length - 1][1] };
}

/** A named timeline: beats [[name, length], …]. at(t, name) is the 0..1 progress of t through that beat. */
export class Timeline {
  constructor(beats) {
    this.span = {}; let t = 0;
    for (const [name, d] of beats) { this.span[name] = [t, t + d]; t += d; }
    this.total = t;
  }
  at(t, name) { const [a, b] = this.span[name]; return clamp((t - a) / (b - a)); }
  /** Progress through a run of consecutive beats, first..last inclusive. */
  across(t, first, last) { const a = this.span[first][0], b = this.span[last][1]; return clamp((t - a) / (b - a)); }
  in(t, name) { const [a, b] = this.span[name]; return t >= a && t < b; }
}

/**
 * Pins `stage` for the length of the timeline and calls render(t) as you scroll. `scrub` is how many seconds the
 * scene takes to catch up with the scrollbar, so a trackpad stop glides to a halt instead of snapping.
 * onNear fires once when the scene is about two screens away (start loading media then).
 */
export function pinScene({ el, stage, total, unitVh, render, onNear, onResize, onEntry, snap, scrub = 0.3 }) {
  let t = 0;
  const draw = () => render(t);
  window.addEventListener("resize", () => { onResize && onResize(); draw(); });
  onResize && onResize();
  draw();
  const gsap = window.gsap, ST = window.ScrollTrigger;
  if (!gsap || !ST) { onNear && onNear(); return { draw }; }
  gsap.registerPlugin(ST);
  // Reloading mid-page restores the scroll position while the layout is still settling, which leaves the pin
  // measured in the wrong place: re-measure once everything has loaded.
  const remeasure = () => requestAnimationFrame(() => ST.refresh());
  if (document.readyState === "complete") remeasure(); else window.addEventListener("load", remeasure, { once: true });
  if (document.fonts && document.fonts.ready) document.fonts.ready.then(remeasure);
  ST.create({ trigger: el, start: "top 250%", once: true, onEnter: () => onNear && onNear() });
  // Entry: 0 → 1 as the scene scrolls up from the bottom of the window to the pin, for an entrance animation.
  if (onEntry) ST.create({ trigger: el, start: "top bottom", end: "top top", onUpdate: (st) => onEntry(st.progress), onRefresh: (st) => onEntry(st.progress) });
  const proxy = { t: 0 };
  const tween = gsap.to(proxy, {
    t: total, ease: "none",
    scrollTrigger: {
      trigger: el, start: "top top", pin: stage, anticipatePin: 1, invalidateOnRefresh: true,
      end: () => "+=" + Math.round(total * unitVh / 100 * window.innerHeight),
      scrub,
      // Snap: when scrolling stops, glide on to the nearest rest point in the direction of travel, taking between
      // snap.min and snap.max seconds however hard the flick was.
      snap: snap && {
        snapTo: snap.points.map((v) => v / total), directional: true, inertia: false, delay: 0.08, ease: "power2.inOut",
        duration: { min: snap.min, max: snap.max },
      },
    },
    onUpdate: () => { t = proxy.t; draw(); },
  });
  // After any re-measure (load, fonts, resize), jump straight to where the scrollbar is: a reload can land mid-scene
  // and no scroll event follows, so the scrub would otherwise sit at the first frame.
  ST.addEventListener("refresh", () => {
    const st = tween.scrollTrigger;
    if (!st) return;
    tween.progress(st.progress); proxy.t = st.progress * total; t = proxy.t; draw();
  });
  /** Scrolls the page so the scene shows timeline position t. */
  const scrollToT = (t2) => {
    const st = tween.scrollTrigger;
    if (st) window.scrollTo({ top: st.start + (t2 / total) * (st.end - st.start), behavior: "smooth" });
  };
  return { draw, scrollToT };
}
