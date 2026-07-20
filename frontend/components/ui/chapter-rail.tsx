"use client";

import { useEffect, useState } from "react";

/**
 * Desktop-only chapter progress rail. A restrained vertical set of dots+labels
 * near the right edge that reflects which narrative chapter is in view. It is:
 *   - progressive enhancement only: hidden on <lg and under reduced-motion, and
 *     never required for navigation (the nav anchor links remain the real nav);
 *   - driven by IntersectionObserver (no dependency, no scroll hijacking);
 *   - honest about progress: it marks the chapter currently occupying the most
 *     of the viewport as active, so a long chapter being read stays "active"
 *     rather than announcing false progress.
 *
 * Chapters are discovered from `[data-chapter]` sections in the DOM, so the rail
 * stays in sync with the page without a hardcoded list.
 */
export function ChapterRail() {
  const [chapters, setChapters] = useState<{ id: string; label: string }[]>([]);
  const [active, setActive] = useState(0);

  useEffect(() => {
    const desktop = window.matchMedia("(min-width: 1024px)");
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)");
    let io: IntersectionObserver | null = null;

    // Build (or rebuild) chapter observation. Only active on desktop with motion
    // allowed; otherwise it tears down and renders no rail.
    const build = () => {
      teardown();
      if (!desktop.matches || reduce.matches) {
        setChapters([]);
        return;
      }
      const nodes = Array.from(document.querySelectorAll<HTMLElement>("[data-chapter]"));
      if (nodes.length === 0) return;
      const list = nodes.map((n, i) => {
        const label = n.dataset.chapter || `Chapter ${i + 1}`;
        if (!n.id) n.id = `chapter-${i}`;
        return { id: n.id, label };
      });
      setChapters(list);
      setActive(0);

      // Track visible ratio per chapter; active = the one filling the most viewport,
      // so a long chapter being read stays active (no false progress). The active
      // scene is marked via data-scene-active so CSS can give it subtle emphasis
      // (opacity only — no scroll-tied transforms).
      const ratios = new Map<Element, number>();
      const markActive = (idx: number) => {
        nodes.forEach((n, i) => { n.dataset.sceneActive = i === idx ? "true" : "false"; });
      };
      io = new IntersectionObserver(
        (entries) => {
          for (const e of entries) ratios.set(e.target, e.isIntersecting ? e.intersectionRatio : 0);
          let best = 0;
          let bestRatio = -1;
          nodes.forEach((n, i) => {
            const r = ratios.get(n) ?? 0;
            if (r > bestRatio) { bestRatio = r; best = i; }
          });
          setActive(best);
          markActive(best);
        },
        { threshold: [0, 0.15, 0.3, 0.5, 0.75, 1], rootMargin: "-76px 0px 0px 0px" },
      );
      nodes.forEach((n) => io!.observe(n));
      markActive(0);
    };

    const teardown = () => {
      if (io) { io.disconnect(); io = null; }
      // Clear the emphasis attribute so a torn-down rail (mobile/reduced-motion)
      // never leaves scenes dimmed.
      document.querySelectorAll<HTMLElement>("[data-chapter]").forEach((n) => { delete n.dataset.sceneActive; });
    };

    build();

    // React to viewport/motion-preference changes AFTER load: dropping below
    // 1024px or enabling reduced motion removes the rail immediately; returning to
    // desktop / no-preference rebuilds it safely.
    const onChange = () => build();
    desktop.addEventListener("change", onChange);
    reduce.addEventListener("change", onChange);
    return () => {
      desktop.removeEventListener("change", onChange);
      reduce.removeEventListener("change", onChange);
      teardown();
    };
  }, []);

  if (chapters.length === 0) return null;

  return (
    <nav
      aria-label="Chapters"
      className="pointer-events-none fixed right-5 top-1/2 z-30 hidden -translate-y-1/2 flex-col gap-3 lg:flex"
    >
      {chapters.map((c, i) => (
        <a
          key={c.id}
          href={`#${c.id}`}
          className="group pointer-events-auto flex items-center justify-end gap-2.5"
          aria-current={i === active ? "true" : undefined}
        >
          <span
            className={`font-mono text-[10px] uppercase tracking-[0.14em] transition-all duration-300 ${
              i === active ? "text-cloud opacity-100" : "text-fog opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100"
            }`}
          >
            {c.label}
          </span>
          <span
            className={`h-1.5 rounded-full transition-all duration-300 ${
              i === active ? "w-6 bg-cyan shadow-[0_0_8px_#22d3ee]" : "w-1.5 bg-fog/40 group-hover:bg-fog"
            }`}
          />
        </a>
      ))}
    </nav>
  );
}
