"use client";

import { useEffect } from "react";
import Lenis from "lenis";

// Module-level handle so any component can drive the ONE Lenis instance instead
// of calling window.scrollTo (native smooth-scroll fights Lenis and stutters).
let lenisInstance: Lenis | null = null;

/** Scroll to the top through Lenis so it stays in sync (used after a scan so the
 *  fresh report animates into view without a native-vs-Lenis scroll fight). */
export function scrollToTop() {
  if (lenisInstance) lenisInstance.scrollTo(0, { duration: 0.8 });
  else if (typeof window !== "undefined") window.scrollTo({ top: 0, behavior: "smooth" });
}

/** Buttery inertial scrolling site-wide (Lenis). Disabled when the user prefers
 *  reduced motion so accessibility always wins. */
export function SmoothScroll({ children }: { children: React.ReactNode }) {
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    // lerp-based smoothing gives the buttery, weighted feel. autoResize keeps
    // Lenis in sync when big content mounts/unmounts (scan results) so it never
    // "stops" at a stale height; a ResizeObserver backstop covers layout shifts.
    const lenis = new Lenis({ lerp: 0.1, smoothWheel: true, wheelMultiplier: 1, touchMultiplier: 1.6, autoResize: true });
    lenisInstance = lenis;

    // During FAST scrolling, flag <html data-scrolling> so the heavy per-frame
    // paint (backdrop-filter blur on glass cards) can pause — that repaint every
    // frame was the "stopping / loading" feel. Gated on velocity so slow,
    // deliberate scrolls (which have frame budget to spare) keep the blur and
    // never flicker; only high-velocity motion — where the blur diff is invisible
    // anyway — suppresses it. Restored ~140ms after motion settles.
    const root = document.documentElement;
    let idle: ReturnType<typeof setTimeout> | undefined;
    const onScroll = () => {
      if (Math.abs(lenis.velocity) > 1.2) {
        root.dataset.scrolling = "1";
        if (idle) clearTimeout(idle);
        idle = setTimeout(() => { delete root.dataset.scrolling; }, 140);
      }
    };
    lenis.on("scroll", onScroll);

    let raf = 0;
    const loop = (time: number) => {
      lenis.raf(time);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    const ro = new ResizeObserver(() => lenis.resize());
    ro.observe(document.body);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
      if (idle) clearTimeout(idle);
      delete root.dataset.scrolling;
      lenis.destroy();
      lenisInstance = null;
    };
  }, []);
  return <>{children}</>;
}
