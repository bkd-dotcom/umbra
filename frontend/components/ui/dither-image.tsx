"use client";

import { useEffect, useRef, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * DitherImage — Aceternity "Dither Shader" / "Pixelated Canvas" treatment.
 *
 * Renders an image as an ordered (Bayer 4×4) dither on a 2D canvas: the photo is
 * downsampled to a cell grid, each cell's luminance is dithered into a few tonal
 * levels, and those levels are mapped along a brand duotone ramp (ink → cyan →
 * cloud). This is the retro/pixel-art look from ui.aceternity.com's Dither
 * component, implemented on a plain canvas so it works inside the Next.js static
 * export with no WebGL dependency and stays legible at both avatar and card size.
 *
 * - `pixelSize` sets the cell size in CSS px (smaller = finer/more recognizable).
 * - Draws once on load and re-draws on resize; there is no animation, so it is
 *   inherently reduced-motion safe.
 * - Cross-origin sources are loaded with crossOrigin="anonymous" (GitHub/Google
 *   avatars send permissive CORS). If a pixel read is ever blocked (tainted
 *   canvas), it silently falls back to a plain <img>.
 */

// Normalized Bayer 4×4 ordered-dither thresholds (0..1).
const BAYER4 = [
  [0, 8, 2, 10],
  [12, 4, 14, 6],
  [3, 11, 1, 9],
  [15, 7, 13, 5],
].map((row) => row.map((v) => (v + 0.5) / 16));

type RGB = [number, number, number];
const INK: RGB = [8, 10, 18];
const CLOUD: RGB = [238, 241, 249];
const CYAN: RGB = [34, 211, 238];

const lerp = (a: RGB, b: RGB, t: number): RGB => [
  Math.round(a[0] + (b[0] - a[0]) * t),
  Math.round(a[1] + (b[1] - a[1]) * t),
  Math.round(a[2] + (b[2] - a[2]) * t),
];

// Duotone ramp with a cool cyan-tinted midtone, so faces stay recognizable while
// reading unmistakably as an Umbra-brand dither.
const MID: RGB = lerp(lerp(INK, CLOUD, 0.5), CYAN, 0.3);
function ramp(q: number): RGB {
  return q < 0.5 ? lerp(INK, MID, q / 0.5) : lerp(MID, CLOUD, (q - 0.5) / 0.5);
}

export function DitherImage({
  src,
  className,
  pixelSize = 4,
  levels = 4,
  strength = 0.55,
  rounded = false,
}: {
  src: string;
  className?: string;
  pixelSize?: number;
  levels?: number;
  strength?: number;
  rounded?: boolean;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const [tainted, setTainted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setTainted(false);

    const draw = () => {
      const wrap = wrapRef.current;
      const canvas = canvasRef.current;
      const img = imgRef.current;
      if (!wrap || !canvas || !img) return;
      const W = Math.max(1, Math.round(wrap.clientWidth));
      const H = Math.max(1, Math.round(wrap.clientHeight));
      if (W < 2 || H < 2) return;

      const cols = Math.max(1, Math.floor(W / pixelSize));
      const rows = Math.max(1, Math.floor(H / pixelSize));

      // Downsample the source into a cols×rows grid (object-fit: cover).
      const off = document.createElement("canvas");
      off.width = cols;
      off.height = rows;
      const octx = off.getContext("2d");
      if (!octx) return;
      const scale = Math.max(cols / img.width, rows / img.height);
      const dw = img.width * scale;
      const dh = img.height * scale;
      octx.drawImage(img, (cols - dw) / 2, (rows - dh) / 2, dw, dh);

      let px: Uint8ClampedArray;
      try {
        px = octx.getImageData(0, 0, cols, rows).data;
      } catch {
        setTainted(true); // cross-origin taint — fall back to a plain <img>
        return;
      }

      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.style.width = `${W}px`;
      canvas.style.height = `${H}px`;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, W, H);

      const cw = W / cols;
      const ch = H / rows;
      const step = levels - 1;
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const i = (y * cols + x) * 4;
          const lum = (0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2]) / 255;
          const dithered = lum + (BAYER4[y & 3][x & 3] - 0.5) * strength;
          const q = Math.max(0, Math.min(1, Math.round(dithered * step) / step));
          const [r, g, b] = ramp(q);
          ctx.fillStyle = `rgb(${r},${g},${b})`;
          // +1px overdraw closes seams between cells at fractional sizes.
          ctx.fillRect(x * cw, y * ch, cw + 1, ch + 1);
        }
      }
    };

    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => {
      if (cancelled) return;
      imgRef.current = img;
      draw();
    };
    img.onerror = () => {
      if (!cancelled) setTainted(true);
    };
    img.src = src;

    const ro = new ResizeObserver(() => draw());
    if (wrapRef.current) ro.observe(wrapRef.current);

    return () => {
      cancelled = true;
      ro.disconnect();
    };
  }, [src, pixelSize, levels, strength]);

  return (
    <div ref={wrapRef} className={cn("relative overflow-hidden", rounded && "rounded-full", className)}>
      {tainted ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" loading="lazy" decoding="async" className="h-full w-full object-cover" />
      ) : (
        <canvas ref={canvasRef} className="block h-full w-full" aria-hidden />
      )}
    </div>
  );
}
