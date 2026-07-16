"use client";

import { cn } from "@/lib/utils";

/** Aceternity-style SVG spotlight that washes light across the hero. Purely
 *  decorative; sits behind content with a slow fade-in. */
export function Spotlight({ className, fill = "white" }: { className?: string; fill?: string }) {
  return (
    <svg
      className={cn(
        "pointer-events-none absolute z-0 h-[169%] w-[138%] opacity-0 animate-[spotlight_2.4s_ease_.4s_forwards] lg:w-[84%]",
        className,
      )}
      viewBox="0 0 3787 2842"
      fill="none"
      aria-hidden
    >
      <g filter="url(#spot)">
        <ellipse
          cx="1924.71"
          cy="273.501"
          rx="1924.71"
          ry="273.501"
          transform="matrix(-0.822377 -0.568943 -0.568943 0.822377 3631.88 2291.09)"
          fill={fill}
          fillOpacity="0.18"
        />
      </g>
      <defs>
        <filter id="spot" x="0.860352" y="0.838989" width="3785.16" height="2840.26" filterUnits="userSpaceOnUse" colorInterpolationFilters="sRGB">
          <feFlood floodOpacity="0" result="BackgroundImageFix" />
          <feBlend mode="normal" in="SourceGraphic" in2="BackgroundImageFix" result="shape" />
          <feGaussianBlur stdDeviation="151" result="effect1_foregroundBlur" />
        </filter>
      </defs>
      <style>{`@keyframes spotlight{0%{opacity:0;transform:translate(-72%,-62%) scale(.5)}100%{opacity:1;transform:translate(-50%,-40%) scale(1)}}`}</style>
    </svg>
  );
}
