"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import * as THREE from "three";

/** Render only while the canvas is on screen. Two always-on WebGL loops (this +
 *  the dependency graph) otherwise render 60fps forever and steal frames from
 *  scrolling. Pausing off-screen keeps scroll smooth; resumes on scroll-back. */
function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(([e]) => setVisible(e.isIntersecting), { rootMargin: "150px" });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return { ref, visible };
}

/** Interactive 3D threat scatter — every advisory is a node on a slowly rotating
 *  DNA-style helix. Angle spirals with index, radius grows with severity, colour
 *  encodes severity, and critical nodes pulse. Drag to orbit, scroll to zoom,
 *  hover a node for its package + CVE. All positions are pure functions of the
 *  real scan, so re-running a scan re-plots live. */
export type ThreatPoint = { package: string; version: string; cve: string; severity: string; summary?: string };

const SEV_COLOR: Record<string, string> = { critical: "#fb7185", high: "#fb923c", medium: "#facc15", low: "#38bdf8" };
const SEV_RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };

function sev(v: string): string {
  return (v || "low").toLowerCase();
}

function Node({ p, position }: { p: ThreatPoint; position: [number, number, number] }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<THREE.Mesh>(null);
  const color = SEV_COLOR[sev(p.severity)] ?? "#38bdf8";
  const critical = sev(p.severity) === "critical";

  useFrame(({ clock }) => {
    if (ref.current && critical) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.14);
  });

  return (
    <group position={position}>
      {/* soft halo */}
      <mesh scale={hovered ? 2.1 : 1.7}>
        <sphereGeometry args={[0.22, 16, 16]} />
        <meshBasicMaterial color={color} transparent opacity={0.12} />
      </mesh>
      <mesh
        ref={ref}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[0.22, 28, 28]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={critical ? 0.95 : 0.45} roughness={0.35} metalness={0.1} />
      </mesh>
      {hovered && (
        <Html center distanceFactor={11} zIndexRange={[50, 0]}>
          <div className="pointer-events-none w-max max-w-[220px] -translate-y-8 rounded-lg border border-white/15 bg-black/85 px-3 py-2 text-left shadow-xl backdrop-blur-sm">
            <div className="font-mono text-[11px] text-white">{p.package}<span className="text-white/50">@{p.version}</span></div>
            <div className="mt-0.5 font-mono text-[10px]" style={{ color }}>{sev(p.severity).toUpperCase()} · {p.cve}</div>
          </div>
        </Html>
      )}
    </group>
  );
}

function Helix({ points }: { points: ThreatPoint[] }) {
  const group = useRef<THREE.Group>(null);
  const placed = useMemo(() => {
    const n = points.length;
    const turns = Math.max(1, Math.min(4, Math.ceil(n / 6)));
    const height = 6;
    return points.map((p, i) => {
      const t = n <= 1 ? 0.5 : i / (n - 1);
      const angle = t * Math.PI * 2 * turns;
      const radius = 1.5 + (SEV_RANK[sev(p.severity)] ?? 0) * 0.4;
      const y = (t - 0.5) * height;
      return { p, pos: [Math.cos(angle) * radius, y, Math.sin(angle) * radius] as [number, number, number] };
    });
  }, [points]);

  useFrame((_, delta) => { if (group.current) group.current.rotation.y += delta * 0.16; });

  return (
    <group ref={group}>
      {placed.length > 1 && <Line points={placed.map((n) => n.pos)} color="#22d3ee" lineWidth={1} transparent opacity={0.25} />}
      {placed.map((n, i) => <Node key={`${n.p.cve}-${i}`} p={n.p} position={n.pos} />)}
    </group>
  );
}

function ClearState() {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => { if (ref.current) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 1.5) * 0.08); });
  return (
    <group>
      <mesh ref={ref}>
        <icosahedronGeometry args={[1.3, 1]} />
        <meshStandardMaterial color="#5eead4" emissive="#5eead4" emissiveIntensity={0.5} wireframe />
      </mesh>
    </group>
  );
}

export function ThreatScatter3D({ points, className = "h-[300px] w-full" }: { points: ThreatPoint[]; className?: string }) {
  const { ref, visible } = useOnScreen<HTMLDivElement>();
  return (
    <div ref={ref} className={className}>
      <Canvas frameloop={visible ? "always" : "never"} camera={{ position: [0, 0, 9], fov: 50 }} dpr={[1, 1.75]}>
        <ambientLight intensity={0.6} />
        <pointLight position={[6, 8, 6]} intensity={80} />
        <pointLight position={[-6, -4, -4]} intensity={30} color="#a78bfa" />
        {points.length ? <Helix points={points} /> : <ClearState />}
        <OrbitControls enablePan={false} enableZoom minDistance={5} maxDistance={16} autoRotate={false} />
      </Canvas>
    </div>
  );
}
