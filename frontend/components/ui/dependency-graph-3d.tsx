"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame } from "@react-three/fiber";
import { OrbitControls, Line, Html } from "@react-three/drei";
import * as THREE from "three";

/** Render only while on screen — two always-on WebGL loops otherwise steal
 *  frames from scrolling. Resumes when scrolled back into view. */
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

/** Interactive 3D dependency graph. The repo sits at the centre; dependencies
 *  are distributed on a sphere (golden-angle / Fibonacci) around it with an edge
 *  to each. Vulnerable dependencies glow red and pulse. Drag to orbit, scroll to
 *  zoom, hover a node for its name + version. Built entirely from the real scan's
 *  `dependencies`, so it reflects the actual repo. */
export type GraphDep = { name: string; version?: string; vulnerable?: boolean };

function DepNode({ dep, position }: { dep: GraphDep; position: [number, number, number] }) {
  const [hovered, setHovered] = useState(false);
  const ref = useRef<THREE.Mesh>(null);
  const color = dep.vulnerable ? "#fb7185" : "#8b90a6";

  useFrame(({ clock }) => {
    if (ref.current && dep.vulnerable) ref.current.scale.setScalar(1 + Math.sin(clock.elapsedTime * 3) * 0.18);
  });

  return (
    <group position={position}>
      {dep.vulnerable && (
        <mesh scale={2.2}>
          <sphereGeometry args={[0.16, 16, 16]} />
          <meshBasicMaterial color={color} transparent opacity={0.14} />
        </mesh>
      )}
      <mesh
        ref={ref}
        onPointerOver={(e) => { e.stopPropagation(); setHovered(true); }}
        onPointerOut={() => setHovered(false)}
      >
        <sphereGeometry args={[dep.vulnerable ? 0.2 : 0.15, 24, 24]} />
        <meshStandardMaterial color={color} emissive={color} emissiveIntensity={dep.vulnerable ? 0.85 : 0.25} roughness={0.4} />
      </mesh>
      {hovered && (
        <Html center distanceFactor={12} zIndexRange={[50, 0]}>
          <div className="pointer-events-none w-max max-w-[200px] -translate-y-7 rounded-lg border border-white/15 bg-black/85 px-2.5 py-1.5 shadow-xl backdrop-blur-sm">
            <div className="font-mono text-[11px] text-white">{dep.name}{dep.version ? <span className="text-white/50">@{dep.version}</span> : null}</div>
            {dep.vulnerable && <div className="font-mono text-[10px] text-rose-400">vulnerable</div>}
          </div>
        </Html>
      )}
    </group>
  );
}

function Graph({ deps, root }: { deps: GraphDep[]; root: string }) {
  const group = useRef<THREE.Group>(null);
  const placed = useMemo(() => {
    const shown = deps.slice(0, 60);
    const n = Math.max(1, shown.length);
    const R = 4.2;
    return shown.map((dep, i) => {
      const y = n === 1 ? 0 : 1 - (i / (n - 1)) * 2; // 1 → -1
      const r = Math.sqrt(Math.max(0, 1 - y * y));
      const theta = i * 2.399963229; // golden angle
      return { dep, pos: [Math.cos(theta) * r * R, y * R, Math.sin(theta) * r * R] as [number, number, number] };
    });
  }, [deps]);

  useFrame((_, delta) => { if (group.current) group.current.rotation.y += delta * 0.12; });

  return (
    <group ref={group}>
      {placed.map((n, i) => (
        <Line key={`e-${n.dep.name}-${i}`} points={[[0, 0, 0], n.pos]} color={n.dep.vulnerable ? "#fb7185" : "#3a4467"} lineWidth={1} transparent opacity={n.dep.vulnerable ? 0.55 : 0.22} />
      ))}
      {/* root */}
      <mesh>
        <sphereGeometry args={[0.5, 32, 32]} />
        <meshStandardMaterial color="#0a0c14" emissive="#22d3ee" emissiveIntensity={0.7} roughness={0.3} />
      </mesh>
      <Html center distanceFactor={12} zIndexRange={[40, 0]}>
        <div className="pointer-events-none -translate-y-6 whitespace-nowrap font-mono text-[11px] text-cyan">{root}</div>
      </Html>
      {placed.map((n, i) => <DepNode key={`${n.dep.name}-${i}`} dep={n.dep} position={n.pos} />)}
    </group>
  );
}

export function DependencyGraph3D({ deps, root = "repo", className = "h-[320px] w-full" }: { deps: GraphDep[]; root?: string; className?: string }) {
  // Hooks run unconditionally before the early return so hook order stays stable.
  const { ref, visible } = useOnScreen<HTMLDivElement>();
  if (!deps.length) {
    return <div className={`grid place-items-center text-sm text-fog ${className}`}>No dependencies discovered in this repo.</div>;
  }
  return (
    <div ref={ref} className={className}>
      <Canvas frameloop={visible ? "always" : "never"} camera={{ position: [0, 0, 11], fov: 50 }} dpr={[1, 1.75]}>
        <ambientLight intensity={0.6} />
        <pointLight position={[8, 8, 8]} intensity={90} />
        <pointLight position={[-8, -6, -4]} intensity={30} color="#a78bfa" />
        <Graph deps={deps} root={root} />
        <OrbitControls enablePan={false} enableZoom minDistance={6} maxDistance={22} />
      </Canvas>
    </div>
  );
}
