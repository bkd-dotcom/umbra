"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Aceternity "Hover Border Gradient" — a pill whose gradient border sweeps on
 *  hover. Renders as <a> when `href` is given, else <button>. */
export function HoverBorderGradient({
  children,
  href,
  onClick,
  className,
  type,
}: {
  children: React.ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
  type?: "button" | "submit";
}) {
  const inner = (
    <span
      className={cn(
        "relative z-10 flex items-center justify-center gap-2.5 rounded-full bg-ink px-5 py-3 text-sm font-medium text-cloud transition-colors",
        className,
      )}
    >
      {children}
    </span>
  );

  // Press feedback: on :active, drop the hover lift and scale down slightly so the
  // primary CTA feels like it physically responds to the click (Emil Kowalski's
  // rule — any pressable element should confirm the press). Snappy 200ms transform.
  const shell =
    "group relative inline-flex w-fit items-center justify-center overflow-hidden rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] p-px transition-transform duration-200 ease-out hover:-translate-y-0.5 active:translate-y-0 active:scale-[0.97]";

  const sweep = (
    <motion.span
      aria-hidden
      className="absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
      style={{
        background:
          "conic-gradient(from 0deg, transparent, #22d3ee, #a78bfa, #f472b6, transparent 60%)",
      }}
      animate={{ rotate: 360 }}
      transition={{ duration: 4, repeat: Infinity, ease: "linear" }}
    />
  );

  if (href) {
    return (
      <a href={href} className={shell}>
        {sweep}
        {inner}
      </a>
    );
  }
  return (
    <button type={type ?? "button"} onClick={onClick} className={shell}>
      {sweep}
      {inner}
    </button>
  );
}
