"use client";

import { useEffect } from "react";

/**
 * One client island that wires every site-wide effect through data attributes,
 * so the page itself can stay a server component:
 *   [data-reveal]        → .is-in when scrolled into view (+ [data-count] count-ups)
 *   [data-progress]      → --p (0..1) scroll progress: "pin" | "read" | "through"
 *   [data-hscroll]       → vertical scroll drives a horizontal track ([data-htrack])
 *   [data-marquee="±1"]  → ticker whose speed/direction follows scroll velocity
 *   [data-magnetic]      → element leans toward the pointer
 *   [data-tilt]          → 3D tilt under the pointer
 *   [data-drag]          → draggable polaroids
 *   [data-nav]           → solid once scrolled; always on screen
 *   [data-fab]           → floating Order button, shown once the landing cover is passed
 *   [data-menu-toggle]   → mobile menu
 *   [data-toprogress]    → back-to-top ring
 * plus a custom cursor and a sprinkle trail / click-confetti canvas.
 * Everything degrades to static content without JS or with reduced motion.
 */

const SPRINKLES = ["#d7263d", "#f5ecdc", "#b3c68b", "#e2a75c", "#f2b8b5", "#8a5a3c", "#ffe2a8"];

type P = { x: number; y: number; vx: number; vy: number; r: number; vr: number; life: number; max: number; c: string; w: number; h: number };

export default function FX() {
  useEffect(() => {
    const root = document.documentElement;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const fine = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    const $$ = <T extends HTMLElement>(s: string) => Array.from(document.querySelectorAll<T>(s));
    const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
    const cleanups: (() => void)[] = [];
    const on = <K extends keyof WindowEventMap>(t: Window | Document | HTMLElement, ev: K | string, fn: (e: never) => void, opts?: AddEventListenerOptions) => {
      t.addEventListener(ev, fn as EventListener, opts);
      cleanups.push(() => t.removeEventListener(ev, fn as EventListener, opts));
    };

    root.classList.add("fx");
    cleanups.push(() => root.classList.remove("fx"));

    /* ---------------- live sections ----------------
       Decorative infinite animations only run while their section is on screen
       (CSS pauses everything inside [data-live]:not(.is-live)). */
    const liveIO = new IntersectionObserver(
      (es) => es.forEach((e) => (e.target as HTMLElement).classList.toggle("is-live", e.isIntersecting)),
      { rootMargin: "80px 0px" },
    );
    $$("[data-live]").forEach((el) => liveIO.observe(el));
    cleanups.push(() => liveIO.disconnect());

    /* ---------------- count-ups ---------------- */
    const countUp = (el: HTMLElement) => {
      const target = Number(el.dataset.count);
      if (!Number.isFinite(target)) return;
      const fmt = (n: number) => (el.dataset.plain != null ? String(n) : n.toLocaleString("en-IN"));
      if (reduce) return void (el.textContent = fmt(target));
      const start = performance.now();
      const dur = 1800;
      const step = (t: number) => {
        const k = clamp((t - start) / dur);
        const e = 1 - Math.pow(2, -10 * k);
        el.textContent = fmt(Math.round(target * (k === 1 ? 1 : e)));
        if (k < 1) requestAnimationFrame(step);
      };
      requestAnimationFrame(step);
    };

    /* ---------------- reveal ---------------- */
    let pending = $$("[data-reveal]");
    const reveal = (el: HTMLElement) => {
      el.classList.add("is-in");
      el.querySelectorAll<HTMLElement>("[data-count]").forEach(countUp);
      if (el.dataset.count) countUp(el);
    };
    if (reduce) {
      pending.forEach(reveal);
      pending = [];
    }
    const checkReveal = () => {
      if (!pending.length) return;
      const vh = window.innerHeight;
      const hits: HTMLElement[] = [];
      pending = pending.filter((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < vh * 0.88 && (r.width || r.height)) {
          hits.push(el);
          return false;
        }
        return true;
      });
      hits.forEach(reveal);
    };

    /* ---------------- progress + horizontal scroll ---------------- */
    const progEls = $$("[data-progress]");
    const hs = $$("[data-hscroll]").map((sec) => ({ sec, track: sec.querySelector<HTMLElement>("[data-htrack]"), dist: 0, on: false }));
    const layoutH = () => {
      for (const h of hs) {
        if (!h.track) continue;
        const want = window.innerWidth >= 900 && !reduce;
        h.on = want;
        h.sec.classList.toggle("is-pinned", want);
        if (!want) {
          h.sec.style.height = "";
          h.track.style.transform = "";
          continue;
        }
        h.dist = Math.max(0, h.track.scrollWidth - window.innerWidth);
        h.sec.style.height = `${h.dist + window.innerHeight}px`;
      }
    };
    // all rect reads happen first, then all writes — no forced reflow between them
    /* --p is registered as non-inheriting (globals.css), so it has to land on
       each element that reads it. Setting it on the section instead would
       invalidate the style of everything inside — the cover alone holds ~200
       nodes, and paid for all of them on every scroll frame. Sections whose
       readers sit deeper (the story words, the gallery word, the back-to-top
       ring) re-export it as --rp, which inherits; they need no entry here. */
    const P_SINKS =
      ".cover__meta,.masthead,.mast__l,.mast__r,.cover__after,.stage__rays," +
      ".pc__scroll,.cake-scroll,.spr,.sticker,.coverlines,.scrollcue";
    const sinksOf = new WeakMap<HTMLElement, HTMLElement[]>();
    const lastP = new WeakMap<HTMLElement, string>();
    const writeP = (el: HTMLElement, p: number) => {
      const v = clamp(p).toFixed(3);
      if (lastP.get(el) === v) return;
      lastP.set(el, v);
      let sinks = sinksOf.get(el);
      if (!sinks) sinksOf.set(el, (sinks = [el, ...el.querySelectorAll<HTMLElement>(P_SINKS)]));
      for (const s of sinks) s.style.setProperty("--p", v);
    };
    const updateProgress = () => {
      const vh = window.innerHeight;
      const reads = progEls.map((el) => el.getBoundingClientRect());
      const hreads = hs.map((h) => (h.on ? h.sec.getBoundingClientRect() : null));
      progEls.forEach((el, i) => {
        const r = reads[i];
        if (r.bottom < -vh || r.top > vh * 2) return;
        const mode = el.dataset.progress;
        if (mode === "pin") writeP(el, -r.top / Math.max(1, r.height - vh));
        else if (mode === "read") writeP(el, (vh * 0.78 - r.top) / Math.max(1, r.height));
        else writeP(el, (vh - r.top) / (r.height + vh));
      });
      hs.forEach((h, i) => {
        const r = hreads[i];
        if (!r || !h.track || r.bottom < -vh || r.top > vh * 2) return;
        const p = clamp(-r.top / Math.max(1, r.height - vh));
        h.track.style.transform = `translate3d(${(-p * h.dist).toFixed(1)}px,0,0)`;
        writeP(h.sec, p);
      });
    };

    /* ---------------- nav + back-to-top ---------------- */
    const nav = document.querySelector<HTMLElement>("[data-nav]");
    const topBtn = document.querySelector<HTMLElement>("[data-toprogress]");
    const fab = document.querySelector<HTMLElement>("[data-fab]");
    let curY = window.scrollY;
    let maxScroll = 1;
    const cover = document.querySelector<HTMLElement>(".cover");
    let coverEnd = 0;
    let vh = window.innerHeight;
    const measure = () => {
      vh = window.innerHeight;
      maxScroll = Math.max(1, document.documentElement.scrollHeight - vh);
      coverEnd = cover ? cover.offsetTop + cover.offsetHeight : 0;
    };
    const updateChrome = () => {
      const y = window.scrollY;
      if (nav) {
        // the bar stays on screen the whole way down — it only gains its solid backing
        nav.classList.toggle("is-solid", y > 40);
      }
      // the floating Order button waits until the landing cover has been scrolled past
      fab?.classList.toggle("is-away", y < coverEnd - vh * 1.25);
      if (topBtn) {
        topBtn.style.setProperty("--p", clamp(y / maxScroll).toFixed(3));
        topBtn.classList.toggle("is-visible", y > 700);
      }
    };

    let ticking = false;
    const onScroll = () => {
      if (ticking) return;
      ticking = true;
      requestAnimationFrame(() => {
        ticking = false;
        checkReveal();
        updateProgress();
        updateChrome();
        curY = window.scrollY;
        nudgeTickers();
      });
    };
    const onResize = () => {
      layoutH();
      measure();
      onScroll();
    };
    layoutH();
    measure();
    checkReveal();
    updateProgress();
    updateChrome();
    on(window, "scroll", onScroll, { passive: true });
    on(window, "resize", onResize, { passive: true });
    // images/fonts can change track widths after first layout
    on(window, "load", onResize);
    const relayout = window.setTimeout(onResize, 1200);
    cleanups.push(() => window.clearTimeout(relayout));

    if (topBtn) on(topBtn, "click", () => window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" }));

    /* ---------------- mobile menu ---------------- */
    $$("[data-menu-toggle]").forEach((b) =>
      on(b, "click", () => {
        const open = root.classList.toggle("menu-open");
        $$("[data-menu-toggle]").forEach((t) => t.setAttribute("aria-expanded", String(open)));
      }),
    );
    $$("[data-menu-link]").forEach((a) => on(a, "click", () => root.classList.remove("menu-open")));

    /* ---------------- magnetic + tilt ---------------- */
    if (fine && !reduce) {
      $$("[data-magnetic]").forEach((el) => {
        const k = Number(el.dataset.magnetic) || 0.3;
        on(el, "pointermove", (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          el.style.translate = `${(e.clientX - r.left - r.width / 2) * k}px ${(e.clientY - r.top - r.height / 2) * k}px`;
        });
        on(el, "pointerleave", () => (el.style.translate = ""));
      });
      $$("[data-tilt]").forEach((el) => {
        on(el, "pointermove", (e: PointerEvent) => {
          const r = el.getBoundingClientRect();
          const x = (e.clientX - r.left) / r.width - 0.5;
          const y = (e.clientY - r.top) / r.height - 0.5;
          el.style.setProperty("--ry", `${x * 10}deg`);
          el.style.setProperty("--rx", `${-y * 10}deg`);
          el.style.setProperty("--gx", `${(x + 0.5) * 100}%`);
          el.style.setProperty("--gy", `${(y + 0.5) * 100}%`);
        });
        on(el, "pointerleave", () => {
          el.style.setProperty("--ry", "0deg");
          el.style.setProperty("--rx", "0deg");
        });
      });
    }

    /* ---------------- draggable polaroids ---------------- */
    let zTop = 10;
    $$("[data-drag]").forEach((el) => {
      let sx = 0, sy = 0, ox = 0, oy = 0, lx = 0, dragging = false;
      on(el, "pointerdown", (e: PointerEvent) => {
        if (e.pointerType === "touch") return;
        dragging = true;
        el.setPointerCapture(e.pointerId);
        sx = e.clientX;
        sy = e.clientY;
        lx = e.clientX;
        el.style.zIndex = String(++zTop);
        el.classList.add("is-dragging");
      });
      on(el, "pointermove", (e: PointerEvent) => {
        if (!dragging) return;
        const x = ox + e.clientX - sx;
        const y = oy + e.clientY - sy;
        const v = clamp((e.clientX - lx) * 1.2, -14, 14);
        lx = e.clientX;
        el.style.translate = `${x}px ${y}px`;
        el.style.rotate = `calc(var(--r, 0deg) + ${v}deg)`;
      });
      const end = (e: PointerEvent) => {
        if (!dragging) return;
        dragging = false;
        ox += e.clientX - sx;
        oy += e.clientY - sy;
        el.style.rotate = "";
        el.classList.remove("is-dragging");
      };
      on(el, "pointerup", end);
      on(el, "pointercancel", end);
    });

    /* ---------------- cursor + sprinkles ---------------- */
    let mx = -100, my = -100, rx = -100, ry = -100;
    let dot: HTMLDivElement | null = null;
    let ring: HTMLDivElement | null = null;
    let label: HTMLSpanElement | null = null;
    if (fine && !reduce) {
      dot = document.createElement("div");
      dot.className = "cur-dot";
      ring = document.createElement("div");
      ring.className = "cur-ring";
      label = document.createElement("span");
      ring.appendChild(label);
      document.body.append(ring, dot);
      root.classList.add("has-cursor");
      cleanups.push(() => {
        dot?.remove();
        ring?.remove();
        root.classList.remove("has-cursor");
      });
      on(document, "mouseover", (e: MouseEvent) => {
        const t = (e.target as Element).closest<HTMLElement>("a, button, [data-cursor], input, textarea, select, label, iframe");
        const text = t?.dataset.cursor ?? "";
        ring!.classList.toggle("is-link", !!t && !text);
        ring!.classList.toggle("is-label", !!text);
        ring!.classList.toggle("is-text", !!t && /^(INPUT|TEXTAREA)$/.test(t.tagName));
        label!.textContent = text;
      });
      on(document, "mouseleave", () => ring!.classList.add("is-gone"));
      on(document, "mouseenter", () => ring!.classList.remove("is-gone"));
      on(window, "mousedown", () => ring!.classList.add("is-down"));
      on(window, "mouseup", () => ring!.classList.remove("is-down"));
    }

    const canvas = document.createElement("canvas");
    canvas.className = "fx-canvas";
    canvas.setAttribute("aria-hidden", "true");
    document.body.appendChild(canvas);
    cleanups.push(() => canvas.remove());
    const ctx = canvas.getContext("2d")!;
    let dpr = 1;
    const size = () => {
      dpr = Math.min(2, window.devicePixelRatio || 1);
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
    };
    size();
    on(window, "resize", size);

    const parts: P[] = [];
    const spawn = (x: number, y: number, vx: number, vy: number, life = 60) => {
      if (parts.length > 220) parts.shift();
      const round = Math.random() < 0.18;
      const h = 3 + Math.random() * 2;
      parts.push({
        x, y, vx, vy,
        r: Math.random() * Math.PI,
        vr: (Math.random() - 0.5) * 0.3,
        life, max: life,
        c: SPRINKLES[(Math.random() * SPRINKLES.length) | 0],
        w: round ? h : h * (2.4 + Math.random()),
        h,
      });
    };
    const burst = (x: number, y: number, n = 28) => {
      for (let i = 0; i < n; i++) {
        const a = (Math.PI * 2 * i) / n + Math.random() * 0.4;
        const s = 3 + Math.random() * 6;
        spawn(x, y, Math.cos(a) * s, Math.sin(a) * s - 2.5, 70 + Math.random() * 30);
      }
    };
    // other components (Cake Lab) can ask for confetti
    on(window, "fx:burst", (e: CustomEvent<{ x: number; y: number; n?: number }>) => {
      if (reduce) return;
      burst(e.detail.x, e.detail.y, e.detail.n ?? 40);
      wake();
    });

    let lastSx = 0, lastSy = 0;
    on(window, "pointermove", (e: PointerEvent) => {
      mx = e.clientX;
      my = e.clientY;
      if (dot) dot.style.transform = `translate3d(${mx}px,${my}px,0)`;
      if (!fine || reduce) return;
      const d = Math.hypot(mx - lastSx, my - lastSy);
      if (d > 28) {
        spawn(mx, my, (mx - lastSx) * 0.04 + (Math.random() - 0.5), -0.6 + Math.random() * 0.6, 55);
        lastSx = mx;
        lastSy = my;
      }
      wake();
    }, { passive: true });
    on(window, "pointerdown", (e: PointerEvent) => {
      if (reduce) return;
      const t = e.target as Element;
      if (t.closest("input, textarea, select, [data-drag], iframe")) return;
      burst(e.clientX, e.clientY, e.pointerType === "touch" ? 16 : 22);
      wake();
    });

    /* ---------------- tickers ----------------
       The ribbons scroll with a CSS animation (compositor thread). Scrolling the
       page speeds them up / reverses them and leans them, then they settle. */
    const ribbons = document.querySelector<HTMLElement>(".ribbons");
    const tickers = reduce
      ? []
      : $$("[data-marquee]")
          .map((el) => el.firstElementChild?.getAnimations()[0])
          .filter((x): x is Animation => !!x);
    let tickY = window.scrollY;
    let tickRate = 1;
    let tickTimer = 0;
    const nudgeTickers = () => {
      if (!tickers.length) return;
      const dy = curY - tickY;
      tickY = curY;
      if (!dy) return;
      const dir = dy < 0 ? -1 : 1;
      const rate = Math.min(7, 1 + Math.abs(dy) * 0.1) * dir;
      if (Math.abs(rate - tickRate) > 0.15) {
        tickRate = rate;
        tickers.forEach((t) => t.updatePlaybackRate(rate));
      }
      ribbons?.style.setProperty("--skew", `${clamp(-dy * 0.15, -7, 7).toFixed(1)}deg`);
      window.clearTimeout(tickTimer);
      tickTimer = window.setTimeout(() => {
        tickRate = dir;
        tickers.forEach((t) => t.updatePlaybackRate(dir));
        ribbons?.style.setProperty("--skew", "0deg");
      }, 160);
    };
    cleanups.push(() => window.clearTimeout(tickTimer));

    /* ---------------- main loop ----------------
       Only runs while the cursor ring is catching up or sprinkles are alive;
       wake() restarts it. Never reads layout. */
    let raf = 0;
    let dirty = false;
    function wake() {
      if (!raf) raf = requestAnimationFrame(loop);
    }
    const loop = () => {
      raf = 0;
      let busy = false;
      // cursor ring (skip once it has caught up)
      if (ring && (Math.abs(mx - rx) > 0.1 || Math.abs(my - ry) > 0.1)) {
        rx += (mx - rx) * 0.16;
        ry += (my - ry) * 0.16;
        ring.style.transform = `translate3d(${rx.toFixed(1)}px,${ry.toFixed(1)}px,0)`;
        busy = true;
      }
      // sprinkles (canvas is hidden entirely when there are none)
      if (parts.length && !dirty) canvas.classList.add("is-on");
      if (parts.length || dirty) {
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        for (let i = parts.length - 1; i >= 0; i--) {
          const p = parts[i];
          p.vy += 0.16;
          p.vx *= 0.985;
          p.x += p.vx;
          p.y += p.vy;
          p.r += p.vr;
          p.life--;
          if (p.life <= 0 || p.y > canvas.height / dpr + 20) {
            parts.splice(i, 1);
            continue;
          }
          ctx.save();
          ctx.globalAlpha = Math.min(1, (p.life / p.max) * 1.6);
          ctx.translate(p.x, p.y);
          ctx.rotate(p.r);
          ctx.fillStyle = p.c;
          ctx.beginPath();
          ctx.roundRect(-p.w / 2, -p.h / 2, p.w, p.h, p.h / 2);
          ctx.fill();
          ctx.restore();
        }
        dirty = parts.length > 0;
        if (!dirty) canvas.classList.remove("is-on");
        busy = true;
      }
      if (busy) raf = requestAnimationFrame(loop);
    };
    wake();
    cleanups.push(() => cancelAnimationFrame(raf));

    return () => cleanups.forEach((f) => f());
  }, []);

  return null;
}
