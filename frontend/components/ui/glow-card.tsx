"use client";

import { useRef, useState } from "react";
import { cn } from "@/lib/utils";

/** Card that combines Aceternity's "Card Spotlight" + "Glowing Effect": a radial
 *  glow follows the cursor and the border lights up on hover. Glassy by default.
 *  Renders a <div>; wrap it in an <a>/<button> when you need interaction. */
export function GlowCard({
  children,
  className,
  glow = "rgba(124,58,237,0.30)",
  ...rest
}: {
  children: React.ReactNode;
  className?: string;
  glow?: string;
} & React.HTMLAttributes<HTMLDivElement>) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ x: -200, y: -200 });

  return (
    <div
      ref={ref}
      onMouseMove={(e) => {
        const rect = ref.current?.getBoundingClientRect();
        if (rect) setPos({ x: e.clientX - rect.left, y: e.clientY - rect.top });
      }}
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-[color:var(--surface-border)] bg-[color:var(--surface)] backdrop-blur-xl transition-colors duration-300 hover:border-[color:var(--surface-border-hover)]",
        className,
      )}
      {...rest}
    >
      <div
        className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
        style={{ background: `radial-gradient(340px circle at ${pos.x}px ${pos.y}px, ${glow}, transparent 42%)` }}
      />
      <div className="relative z-10 h-full">{children}</div>
    </div>
  );
}
