"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";

type Theme = "dark" | "light";

/** Theme toggle. Two variants:
 *  - `fixed` (default): floats top-right. Rendered globally in layout, but hides
 *    itself on routes that host their own inline toggle (`/` and `/dashboard*`) so
 *    it never overlaps their top bar — the overlap was worst on mobile.
 *  - `inline`: just the button, sized to sit inside a nav/header control cluster.
 *  Persists to localStorage; the no-flash script in layout sets the initial theme
 *  before paint so there's no flicker. */
export function ThemeToggle({ variant = "fixed" }: { variant?: "fixed" | "inline" }) {
  const [theme, setTheme] = useState<Theme>("light");
  const [mounted, setMounted] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    const current = (document.documentElement.dataset.theme as Theme) || "light";
    setTheme(current);
    setMounted(true);
  }, []);

  // The fixed floater steps aside on pages that render an inline toggle in their
  // own top bar (landing + dashboard); it stays for pages without one (e.g. privacy).
  if (variant === "fixed" && (pathname === "/" || pathname?.startsWith("/dashboard"))) return null;

  const toggle = () => {
    const next: Theme = theme === "dark" ? "light" : "dark";
    setTheme(next);
    const root = document.documentElement;
    // Enable the color-transition ONLY for the ~450ms of the switch. Otherwise the
    // global transition rule would recompute on nearly every element during scroll
    // and make it feel janky/"loading". See globals.css [data-theme-transition].
    root.dataset.themeTransition = "1";
    window.setTimeout(() => { delete root.dataset.themeTransition; }, 450);
    root.dataset.theme = next;
    try {
      localStorage.setItem("umbra-theme", next);
    } catch {
      /* ignore private-mode storage errors */
    }
  };

  const base =
    "grid place-items-center rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface)] backdrop-blur-md transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/50";
  const className =
    variant === "fixed"
      ? `fixed right-4 top-4 z-[60] h-10 w-10 sm:right-6 sm:top-6 ${base}`
      : `h-9 w-9 ${base}`;

  return (
    <button onClick={toggle} aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`} className={className}>
      <AnimatePresence mode="wait" initial={false}>
        {mounted && (
          <motion.span
            key={theme}
            initial={{ opacity: 0, rotate: -90, scale: 0.6 }}
            animate={{ opacity: 1, rotate: 0, scale: 1 }}
            exit={{ opacity: 0, rotate: 90, scale: 0.6 }}
            transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
            className="text-cloud"
          >
            {theme === "dark" ? <MoonIcon /> : <SunIcon />}
          </motion.span>
        )}
      </AnimatePresence>
    </button>
  );
}

const MoonIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]" aria-hidden>
    <path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z" />
  </svg>
);
const SunIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-[18px] w-[18px]" aria-hidden>
    <circle cx="12" cy="12" r="4.2" />
    <path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M19.1 4.9l-1.8 1.8M6.7 17.3l-1.8 1.8" />
  </svg>
);
