// Page behavior for the reel: lazy media, reveal, and nav state.
// Scroll scenes live in scenes.js and the agent workspace in scope.js. The page reads fine if any of them fails.
(function () {
  "use strict";
  var reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };
  var io = "IntersectionObserver" in window;
  var play = function (v) { if (reduceMotion) return; var p = v.play(); if (p && p.catch) p.catch(function () {}); };

  // ---- Lazy video loading: attach sources only when a video gets close ----
  function load(video) {
    if (video.dataset.loaded) return;
    $$("source[data-src]", video).forEach(function (s) { s.src = s.dataset.src; });
    video.load();
    video.dataset.loaded = "1";
  }
  if (io) {
    var loadIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { load(e.target); loadIO.unobserve(e.target); } });
    }, { rootMargin: "120% 0px" });
    $$("video").forEach(function (v) { loadIO.observe(v); });
    // Autoplaying loops play only while visible.
    var playIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) play(e.target); else e.target.pause(); });
    }, { threshold: 0.2 });
    $$("video[autoplay]").forEach(function (v) { playIO.observe(v); });
  } else {
    $$("video").forEach(load);
  }

  // ---- Reveal on scroll ----
  var reveals = $$(".reveal");
  if (!reduceMotion && io) {
    var revealIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add("is-in"); revealIO.unobserve(e.target); } });
    }, { rootMargin: "0px 0px -10% 0px", threshold: 0.05 });
    reveals.forEach(function (el) { revealIO.observe(el); });
  } else {
    reveals.forEach(function (el) { el.classList.add("is-in"); });
  }

  // ---- Counters count up once when they come into view ----
  var counts = $$("[data-count]");
  function countUp(el) {
    var n = parseFloat(el.dataset.count), suffix = el.dataset.suffix || "", t0 = null;
    if (reduceMotion) { el.textContent = n + suffix; return; }
    function step(now) {
      if (t0 === null) t0 = now;
      var x = Math.min(1, (now - t0) / 1100), e = 1 - Math.pow(1 - x, 3);
      el.textContent = Math.round(n * e) + suffix;
      if (x < 1) requestAnimationFrame(step);
    }
    el.textContent = "0" + suffix;
    requestAnimationFrame(step);
  }
  if (io) {
    var countIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { countUp(e.target); countIO.unobserve(e.target); } });
    }, { threshold: 0.6 });
    counts.forEach(function (el) { countIO.observe(el); });
  }

  // ---- Wide photos: a gentle push as they pass through the viewport ----
  var pushes = $$("[data-push]");
  function push() {
    if (reduceMotion) return;
    var h = innerHeight;
    pushes.forEach(function (el) {
      var r = el.getBoundingClientRect();
      if (r.bottom < 0 || r.top > h) return;
      var p = Math.max(0, Math.min(1, (h - r.top) / (h + r.height)));
      el.style.transform = "scale(" + (1.08 - 0.08 * p).toFixed(4) + ")";
    });
  }

  // ---- Smooth in-page links (not CSS scroll-behavior, which throws off ScrollTrigger's pin measurements) ----
  document.addEventListener("click", function (e) {
    var a = e.target.closest && e.target.closest('a[href^="#"]');
    if (!a || a.getAttribute("href").length < 2) return;
    var target = document.getElementById(a.getAttribute("href").slice(1));
    if (!target) return;
    e.preventDefault();
    target.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth" });
    history.replaceState(null, "", a.getAttribute("href"));
  });

  // ---- Active chapter in the nav ----
  var navLinks = $$(".chapters a");
  if (io) {
    var chapterIO = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (!e.isIntersecting) return;
        navLinks.forEach(function (a) { a.classList.toggle("is-active", a.getAttribute("href") === "#" + e.target.id); });
      });
    }, { rootMargin: "-45% 0px -50% 0px" });
    $$("[data-chapter]").forEach(function (el) { chapterIO.observe(el); });
  }

  // ---- Top bar background and scroll progress line ----
  var bar = $("#bar"), progress = $("#progress");
  function onScroll() {
    var y = window.scrollY, max = document.documentElement.scrollHeight - innerHeight;
    bar.classList.toggle("is-solid", y > innerHeight * 0.6);
    progress.style.transform = "scaleX(" + (max > 0 ? y / max : 0) + ")";
    push();
  }
  window.addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  // ---- Email links: if no mail app opens (some in-app browsers ignore mailto:), show the address to copy ----
  var mailPop = null;
  function showMail(link, address) {
    if (!mailPop) {
      mailPop = document.createElement("div");
      mailPop.className = "mail-pop";
      mailPop.setAttribute("role", "dialog");
      mailPop.setAttribute("aria-label", "Email address");
      mailPop.innerHTML = '<span class="mail-pop-addr"></span><button type="button" class="pill solid">Copy</button><button type="button" class="mail-pop-x" aria-label="Close">×</button>';
      document.body.appendChild(mailPop);
      mailPop.querySelector(".mail-pop-x").addEventListener("click", function () { mailPop.classList.remove("is-on"); });
      document.addEventListener("keydown", function (e) { if (e.key === "Escape") mailPop.classList.remove("is-on"); });
      document.addEventListener("click", function (e) { if (!mailPop.contains(e.target) && !e.target.closest('a[href^="mailto:"]')) mailPop.classList.remove("is-on"); });
    }
    mailPop.querySelector(".mail-pop-addr").textContent = address;
    var copy = mailPop.querySelector(".pill");
    copy.textContent = "Copy";
    copy.onclick = function () {
      var done = function () { copy.textContent = "Copied"; };
      if (navigator.clipboard) navigator.clipboard.writeText(address).then(done, function () { selectAddr(); });
      else selectAddr();
    };
    function selectAddr() {
      var r = document.createRange(); r.selectNodeContents(mailPop.querySelector(".mail-pop-addr"));
      var sel = getSelection(); sel.removeAllRanges(); sel.addRange(r);
    }
    // Sit under the link, kept on screen.
    var b = link.getBoundingClientRect();
    mailPop.classList.add("is-on");
    var w = mailPop.offsetWidth, h = mailPop.offsetHeight;
    var left = Math.max(12, Math.min(innerWidth - w - 12, b.left));
    var top = b.bottom + 10 + h > innerHeight - 12 ? b.top - h - 10 : b.bottom + 10;
    mailPop.style.left = left + "px"; mailPop.style.top = Math.max(12, top) + "px";
  }
  $$('a[href^="mailto:"]').forEach(function (a) {
    a.addEventListener("click", function () {
      var address = a.getAttribute("href").slice(7).split("?")[0];
      // A mail app taking over blurs or hides the page; if neither happens soon, assume nothing opened.
      var left = false, mark = function () { left = true; };
      window.addEventListener("blur", mark, { once: true });
      document.addEventListener("visibilitychange", mark, { once: true });
      setTimeout(function () {
        window.removeEventListener("blur", mark);
        document.removeEventListener("visibilitychange", mark);
        if (!left && document.hasFocus()) showMail(a, address);
      }, 700);
    });
  });

})();
