"use client";

import { motion } from "motion/react";

export type Dep = { name: string; version?: string; vulnerable?: boolean };

/** Radial dependency graph built from the real scan. The repo sits at the
 *  center; dependencies orbit it and vulnerable ones glow red. Animates in with
 *  a stagger so the map visibly assembles from live data. */
export function DependencyMap({ deps, root = "repo" }: { deps: Dep[]; root?: string }) {
  const shown = deps.slice(0, 28);
  const size = 300;
  const c = size / 2;
  const R = 118;

  if (!shown.length) {
    return <div className="grid h-[300px] place-items-center text-sm text-fog">No dependencies discovered in this repo.</div>;
  }

  return (
    <svg viewBox={`0 0 ${size} ${size}`} className="h-[300px] w-full">
      {shown.map((d, i) => {
        const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * R;
        const y = c + Math.sin(a) * R;
        const color = d.vulnerable ? "#fb7185" : "#3a4467";
        return (
          <motion.line
            key={`l-${d.name}-${i}`}
            x1={c} y1={c} x2={x} y2={y}
            stroke={color} strokeOpacity={d.vulnerable ? 0.6 : 0.28} strokeWidth={d.vulnerable ? 1.4 : 1}
            initial={{ pathLength: 0, opacity: 0 }}
            animate={{ pathLength: 1, opacity: 1 }}
            transition={{ delay: 0.1 + i * 0.02, duration: 0.5 }}
          />
        );
      })}
      {shown.map((d, i) => {
        const a = (i / shown.length) * Math.PI * 2 - Math.PI / 2;
        const x = c + Math.cos(a) * R;
        const y = c + Math.sin(a) * R;
        const color = d.vulnerable ? "#fb7185" : "#8b90a6";
        return (
          <motion.g key={`n-${d.name}-${i}`} initial={{ opacity: 0, scale: 0.4 }} animate={{ opacity: 1, scale: 1 }} transition={{ delay: 0.15 + i * 0.02, type: "spring", stiffness: 260, damping: 18 }}>
            <circle cx={x} cy={y} r={d.vulnerable ? 5 : 3.5} fill={color} style={d.vulnerable ? { filter: "drop-shadow(0 0 6px #fb7185)" } : undefined} />
          </motion.g>
        );
      })}
      <motion.circle cx={c} cy={c} r={16} fill="#0a0c14" stroke="#22d3ee" strokeWidth={1.5} initial={{ scale: 0.5 }} animate={{ scale: 1 }} transition={{ type: "spring", stiffness: 220, damping: 16 }} style={{ filter: "drop-shadow(0 0 10px #22d3ee66)" }} />
      <text x={c} y={c + 3} textAnchor="middle" className="fill-cyan font-mono" style={{ fontSize: 8 }}>{root}</text>
    </svg>
  );
}
