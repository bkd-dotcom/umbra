"use client";

import { useId } from "react";

/**
 * Umbra brand mark + wordmark.
 *
 * Mark: an "eclipse aperture" — a precise ring (the aperture) with an offset
 * umbra disc cutting into it, leaving one exposed crescent edge lit in cyan. Built
 * from exact vector geometry (two offset circles + a masked crescent), not a glow,
 * gradient, orb, brain, shield, or sparkle. Reads as an observatory instrument /
 * review gate. Solid silhouette; cyan appears only on the slim active edge.
 *
 * Wordmark: UMBRA in the loaded technical mono (JetBrains Mono, --ff-mono) at a
 * restrained 0.14em tracking — not the old widely-spaced sci-fi look.
 *
 * Accessibility: the SVG is decorative (aria-hidden); the containing brand link
 * should carry aria-label="Umbra home".
 */
export function UmbraLogo({
  size = 22,
  showWordmark = true,
  className = "",
}: {
  size?: number;
  showWordmark?: boolean;
  className?: string;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 ${className}`}>
      <UmbraMark size={size} />
      {showWordmark && (
        <span
          className="font-mono font-semibold uppercase leading-none text-cloud"
          style={{ fontSize: Math.round(size * 0.68), letterSpacing: "0.14em" }}
        >
          Umbra
        </span>
      )}
    </span>
  );
}

/** The icon-only aperture mark. Crisp from 16px to 32px+. */
export function UmbraMark({ size = 22 }: { size?: number }) {
  // A React-generated, per-instance stable id keeps multiple marks on one page
  // valid (no duplicate mask ids even at the same size). useId() can contain ":"
  // which is invalid in an SVG fragment reference, so sanitize to id-safe chars.
  const rawId = useId();
  const id = `umbra-eclipse-${rawId.replace(/[^a-zA-Z0-9_-]/g, "")}`;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
      focusable="false"
      style={{ display: "block", flexShrink: 0 }}
    >
      <defs>
        {/* The umbra disc, offset up-left, is subtracted from the aperture ring so
            a crescent of the ring stays exposed — the "active edge". */}
        <mask id={id}>
          <rect width="24" height="24" fill="black" />
          <circle cx="12" cy="12" r="8.5" fill="white" />
          <circle cx="9.4" cy="9.4" r="8.5" fill="black" />
        </mask>
      </defs>
      {/* Aperture ring — solid off-white silhouette, occluded by the umbra core. */}
      <circle
        cx="12"
        cy="12"
        r="8.5"
        fill="none"
        stroke="var(--color-cloud)"
        strokeWidth="2.4"
        mask={`url(#${id})`}
      />
      {/* The slim active edge — the only cyan in the mark. A short arc on the lit
          crescent's leading edge. */}
      <path
        d="M 19.1 15.6 A 8.5 8.5 0 0 1 15.6 19.1"
        stroke="var(--color-cyan)"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
