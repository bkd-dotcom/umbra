"use client";
import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { MotionValue, motion, useReducedMotion, useScroll, useTransform } from "motion/react";
import { cn } from "@/lib/utils";
import {
  IconBrightnessDown,
  IconBrightnessUp,
  IconCaretRightFilled,
  IconCaretUpFilled,
  IconChevronUp,
  IconMicrophone,
  IconMoon,
  IconPlayerSkipForward,
  IconPlayerTrackNext,
  IconPlayerTrackPrev,
  IconTable,
  IconVolume,
  IconVolume2,
  IconVolume3,
  IconSearch,
  IconWorld,
  IconCommand,
  IconCaretLeftFilled,
  IconCaretDownFilled,
} from "@tabler/icons-react";

/* A real Aceternity/Fey-style MacBook. The screen is a pre-rendered PNG
   (public/morning-report.png, natural 4:3) so it never distorts. Whole thing
   is aria-hidden (decorative); the surrounding section carries the real copy.

   The device (screen + keyboard deck) is a fixed-size "canvas" (NATIVE_W ×
   NATIVE_H, matching the original pixel-perfect artwork) rendered inside a
   <ScaledCanvas> that measures its own container width via ResizeObserver and
   applies ONE uniform `transform: scale()` — never separate x/y scales, so
   nothing ever distorts, and the reserved layout height always matches the
   visual size exactly (no dead space, no reflow surprises).

   Two render paths, chosen ONCE on mount via matchMedia (never guessed from
   viewport width alone, since a phone can request "desktop site" and report a
   wide innerWidth while still being a coarse-pointer touch device):

   - SAFE STATIC (default on first paint / SSR, and permanent for touch/coarse
     pointer, <1024px, or prefers-reduced-motion): a stable, NON-sticky, fully
     open device at its natural aspect ratio. The keyboard/base is always
     rendered directly beneath the screen in normal document flow — nothing
     scales it away, clips it, or hides it behind the screen.

   - CINEMATIC (only min-width:1024px AND hover:hover AND pointer:fine AND no
     reduced-motion): a restrained sticky-pinned opening over a modest, bounded
     track (not a multi-screen trap). The screen's reserved box height always
     equals its FULLY OPEN height, so the base can never be overlapped/z-hidden
     while the lid animates — unlike the old version, which sized the lid's box
     to the CLOSED height and let the open screen visually spill over the deck. */

const NATIVE_W = 512; // 32rem canvas — matches the source artwork's proportions
const NATIVE_SCREEN_H = 384; // 4:3 aspect, matching morning-report.png (2048×1536)
const NATIVE_BASE_H = 336; // keyboard deck height (21rem, unchanged from original)
const HINGE_OVERLAP = 6; // tiny cosmetic seam only — never enough to cover a key

export const MacbookScroll = ({
  src = "/morning-report.png",
  showGradient,
  title,
  badge,
}: {
  src?: string;
  showGradient?: boolean;
  title?: string | React.ReactNode;
  badge?: React.ReactNode;
}) => {
  const reduce = useReducedMotion();
  // Default to the SAFE static path on first render/SSR — a phone requesting
  // "desktop site" has a coarse pointer and must land here, never in cinema.
  const [cinema, setCinema] = useState(false);

  useEffect(() => {
    if (reduce) return; // reduced-motion always gets the static fully-open device
    const mq = window.matchMedia("(min-width: 1024px) and (hover: hover) and (pointer: fine)");
    const update = () => setCinema(mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, [reduce]);

  if (cinema && !reduce) return <MacbookCinematic src={src} showGradient={showGradient} title={title} badge={badge} />;
  return <MacbookStatic src={src} title={title} badge={badge} />;
};

/** Measures its own rendered width and scales a fixed-size canvas to fit it
 *  uniformly (one scale factor, never separate x/y — no distortion). The
 *  wrapper's height is set to the exact scaled height, so there is never any
 *  leftover dead space below the device. */
function ScaledCanvas({
  nativeWidth,
  nativeHeight,
  className,
  children,
}: {
  nativeWidth: number;
  nativeHeight: number;
  className?: string;
  children: React.ReactNode;
}) {
  const outerRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  useLayoutEffect(() => {
    const el = outerRef.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? nativeWidth;
      setScale(w > 0 ? Math.min(1, w / nativeWidth) : 1);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [nativeWidth]);

  return (
    <div ref={outerRef} className={cn("relative w-full", className)} style={{ height: nativeHeight * scale }}>
      <div style={{ width: nativeWidth, height: nativeHeight, transform: `scale(${scale})`, transformOrigin: "top left" }}>
        {children}
      </div>
    </div>
  );
}

/* ------------------------------- Safe static -------------------------------
   Non-sticky, natural document flow. The screen sits fully open at its
   natural 4:3 aspect ratio; the base is a normal sibling directly beneath it
   in the same fixed-size canvas — always visible, never scaled away, never
   z-hidden, never off-screen. */
function MacbookStatic({
  src,
  title,
  badge,
}: {
  src: string;
  title?: string | React.ReactNode;
  badge?: React.ReactNode;
}) {
  return (
    <div className="relative flex flex-col items-center py-10" aria-label="Morning Report product preview">
      {title && <div className="mb-8 px-4 text-center md:mb-10">{title}</div>}
      <ScaledCanvas
        nativeWidth={NATIVE_W}
        nativeHeight={NATIVE_SCREEN_H + NATIVE_BASE_H - HINGE_OVERLAP}
        className="mx-auto max-w-[26rem] md:max-w-[32rem]"
      >
        <div aria-hidden style={{ width: NATIVE_W }}>
          {/* Screen — fully open, natural aspect ratio, no fold/rotate. */}
          <div className="relative rounded-2xl bg-[#0a0a0c] p-2" style={{ width: NATIVE_W, height: NATIVE_SCREEN_H }}>
            <div className="absolute inset-0 rounded-lg bg-[#0a0a0c]" />
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={src} alt="" className="absolute inset-0 h-full w-full rounded-lg object-cover object-left-top" />
          </div>
          {/* Base — directly beneath, in normal flow, always fully visible. */}
          <div style={{ marginTop: -HINGE_OVERLAP }}>
            <Base badge={badge} />
          </div>
        </div>
      </ScaledCanvas>
    </div>
  );
}

/* ------------------------------- Cinematic ---------------------------------
   Desktop, fine-pointer, hover-capable only. A single restrained opening
   choreographed over a modest sticky track (not a multi-viewport trap). The
   Lid's reserved box height always equals the FULLY OPEN screen height, so the
   base can never be overlapped or z-hidden at any point in the animation. */
function MacbookCinematic({
  src,
  showGradient,
  title,
  badge,
}: {
  src: string;
  showGradient?: boolean;
  title?: string | React.ReactNode;
  badge?: React.ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end end"],
  });

  // A single, bounded opening over a modest 130vh track — restrained, not a
  // 220vh multi-scene pin. rotate unfolds the lid from folded (-28°) to
  // upright (0°); scale converges to 1 at rest for a crisp, undistorted image.
  const scale = useTransform(scrollYProgress, [0, 0.6], [0.86, 1]);
  const rotate = useTransform(scrollYProgress, [0.05, 0.15, 0.6], [-28, -28, 0]);
  const foldedOpacity = useTransform(scrollYProgress, [0, 0.12, 0.3], [1, 1, 0]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.55, 0.85], [1, 1, 0]);
  const textY = useTransform(scrollYProgress, [0, 0.85], [0, -24]);

  return (
    <div ref={ref} className="relative h-[130vh]" aria-label="Morning Report product preview">
      {/* soft ambient behind the laptop */}
      <div className="pointer-events-none absolute left-1/2 top-[20vh] h-[46rem] w-[46rem] -translate-x-1/2 rounded-full bg-amber/10 blur-[150px]" aria-hidden />
      <div className="sticky top-0 flex h-screen flex-col items-center justify-center overflow-hidden [perspective:900px]" aria-hidden>
        <motion.div style={{ opacity: textOpacity, y: textY }} className="mb-8 px-4 text-center md:mb-12">
          {title}
        </motion.div>

        <ScaledCanvas
          nativeWidth={NATIVE_W}
          nativeHeight={NATIVE_SCREEN_H + NATIVE_BASE_H - HINGE_OVERLAP}
          className="max-w-[32rem]"
        >
          <motion.div style={{ width: NATIVE_W, scale }}>
            <Lid src={src} rotate={rotate} foldedOpacity={foldedOpacity} />
            {/* Base — a plain sibling in normal flow at a fixed vertical
                position (the Lid box height already equals the fully-open
                screen height), so it can never disappear or seam. */}
            <div style={{ marginTop: -HINGE_OVERLAP }}>
              <Base badge={badge} />
            </div>
          </motion.div>
        </ScaledCanvas>
      </div>
      {showGradient && (
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-48"
          style={{ background: "linear-gradient(to bottom, transparent, var(--color-ink) 78%)" }}
        />
      )}
    </div>
  );
}

export const Lid = ({
  rotate,
  foldedOpacity,
  src,
}: {
  rotate: MotionValue<number>;
  foldedOpacity: MotionValue<number>;
  src: string;
}) => {
  return (
    <div className="relative [perspective:800px]" style={{ width: NATIVE_W, height: NATIVE_SCREEN_H }}>
      {/* folded back of the lid — visible only in the closed/near-closed phase
          (fades out as the screen opens); anchored to the SAME hinge line
          (bottom of this box) as the screen, so there is never a mismatch. */}
      <motion.div
        style={{
          opacity: foldedOpacity,
          transform: "perspective(800px) rotateX(-25deg) translateZ(0px)",
          transformOrigin: "bottom",
        }}
        className="absolute inset-x-0 bottom-0 h-[12rem] w-full rounded-2xl bg-[#0a0a0c] p-2"
      >
        <div
          style={{ boxShadow: "0px 2px 0px 2px #171717 inset" }}
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-[#0a0a0c]"
        >
          <span className="text-white">
            <UmbraMark />
          </span>
        </div>
      </motion.div>
      {/* the screen — unfolds about the SAME bottom hinge line; fixed box size
          (never inset-0 against a shorter parent) so it can never spill over
          the deck below. Natural aspect ratio, no distortion, no cropped edge. */}
      <motion.div
        style={{
          rotateX: rotate,
          transformStyle: "preserve-3d",
          transformOrigin: "bottom",
        }}
        className="absolute inset-0 rounded-2xl bg-[#0a0a0c] p-2"
      >
        <div className="absolute inset-0 rounded-lg bg-[#0a0a0c]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt=""
          className="absolute inset-0 h-full w-full rounded-lg object-cover object-left-top"
        />
      </motion.div>
    </div>
  );
};

/* The keyboard deck — official chrome, shared identically by both the static
   and cinematic paths (same fixed-size canvas) so the base never differs
   between them, and is always a plain block-level element: no scale wrapper,
   no negative z-index, so it can never be hidden, clipped, or seamed. */
export const Base = ({ badge }: { badge?: React.ReactNode }) => {
  return (
    <div className="relative overflow-hidden rounded-b-2xl rounded-t-[3px] bg-gray-200 dark:bg-[#232326]" style={{ width: NATIVE_W, height: NATIVE_BASE_H }}>
      <div className="relative h-10 w-full">
        <div className="absolute inset-x-0 mx-auto h-4 w-[80%] bg-[#050505]" />
      </div>
      <div className="relative flex">
        <div className="mx-auto h-full w-[10%] overflow-hidden">
          <SpeakerGrid />
        </div>
        <div className="mx-auto h-full w-[80%]">
          <Keypad />
        </div>
        <div className="mx-auto h-full w-[10%] overflow-hidden">
          <SpeakerGrid />
        </div>
      </div>
      <Trackpad />
      <div className="absolute inset-x-0 bottom-0 mx-auto h-2 w-20 rounded-tl-3xl rounded-tr-3xl bg-gradient-to-t from-[#272729] to-[#050505]" />
      {badge && <div className="absolute bottom-4 left-4">{badge}</div>}
    </div>
  );
};

export const Trackpad = () => {
  return (
    <div
      className="mx-auto my-1 h-32 w-[40%] rounded-xl"
      style={{ boxShadow: "0px 0px 1px 1px #00000020 inset" }}
    />
  );
};

export const Keypad = () => {
  return (
    <div className="mx-1 h-full [transform:translateZ(0)] rounded-md bg-[#050505] p-1 [will-change:transform]">
      {/* First Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-10 items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">
          esc
        </KBtn>
        <KBtn>
          <IconBrightnessDown className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F1</span>
        </KBtn>
        <KBtn>
          <IconBrightnessUp className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F2</span>
        </KBtn>
        <KBtn>
          <IconTable className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F3</span>
        </KBtn>
        <KBtn>
          <IconSearch className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F4</span>
        </KBtn>
        <KBtn>
          <IconMicrophone className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F5</span>
        </KBtn>
        <KBtn>
          <IconMoon className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F6</span>
        </KBtn>
        <KBtn>
          <IconPlayerTrackPrev className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F7</span>
        </KBtn>
        <KBtn>
          <IconPlayerSkipForward className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F8</span>
        </KBtn>
        <KBtn>
          <IconPlayerTrackNext className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F9</span>
        </KBtn>
        <KBtn>
          <IconVolume3 className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F10</span>
        </KBtn>
        <KBtn>
          <IconVolume2 className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F11</span>
        </KBtn>
        <KBtn>
          <IconVolume className="h-[6px] w-[6px]" />
          <span className="mt-1 inline-block">F12</span>
        </KBtn>
        <KBtn>
          <div className="h-4 w-4 rounded-full bg-gradient-to-b from-neutral-900 from-20% via-black via-50% to-neutral-900 to-95% p-px">
            <div className="h-full w-full rounded-full bg-black" />
          </div>
        </KBtn>
      </div>

      {/* Second row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn><span className="block">~</span><span className="mt-1 block">`</span></KBtn>
        <KBtn><span className="block">!</span><span className="block">1</span></KBtn>
        <KBtn><span className="block">@</span><span className="block">2</span></KBtn>
        <KBtn><span className="block">#</span><span className="block">3</span></KBtn>
        <KBtn><span className="block">$</span><span className="block">4</span></KBtn>
        <KBtn><span className="block">%</span><span className="block">5</span></KBtn>
        <KBtn><span className="block">^</span><span className="block">6</span></KBtn>
        <KBtn><span className="block">&</span><span className="block">7</span></KBtn>
        <KBtn><span className="block">*</span><span className="block">8</span></KBtn>
        <KBtn><span className="block">(</span><span className="block">9</span></KBtn>
        <KBtn><span className="block">)</span><span className="block">0</span></KBtn>
        <KBtn><span className="block">&mdash;</span><span className="block">_</span></KBtn>
        <KBtn><span className="block">+</span><span className="block"> = </span></KBtn>
        <KBtn className="w-10 items-end justify-end pb-[2px] pr-[4px]" childrenClassName="items-end">
          delete
        </KBtn>
      </div>

      {/* Third row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-10 items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">
          tab
        </KBtn>
        <KBtn><span className="block">Q</span></KBtn>
        <KBtn><span className="block">W</span></KBtn>
        <KBtn><span className="block">E</span></KBtn>
        <KBtn><span className="block">R</span></KBtn>
        <KBtn><span className="block">T</span></KBtn>
        <KBtn><span className="block">Y</span></KBtn>
        <KBtn><span className="block">U</span></KBtn>
        <KBtn><span className="block">I</span></KBtn>
        <KBtn><span className="block">O</span></KBtn>
        <KBtn><span className="block">P</span></KBtn>
        <KBtn><span className="block">{`{`}</span><span className="block">{`[`}</span></KBtn>
        <KBtn><span className="block">{`}`}</span><span className="block">{`]`}</span></KBtn>
        <KBtn><span className="block">{`|`}</span><span className="block">{`\\`}</span></KBtn>
      </div>

      {/* Fourth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-[2.8rem] items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">
          caps lock
        </KBtn>
        <KBtn><span className="block">A</span></KBtn>
        <KBtn><span className="block">S</span></KBtn>
        <KBtn><span className="block">D</span></KBtn>
        <KBtn><span className="block">F</span></KBtn>
        <KBtn><span className="block">G</span></KBtn>
        <KBtn><span className="block">H</span></KBtn>
        <KBtn><span className="block">J</span></KBtn>
        <KBtn><span className="block">K</span></KBtn>
        <KBtn><span className="block">L</span></KBtn>
        <KBtn><span className="block">{`:`}</span><span className="block">{`;`}</span></KBtn>
        <KBtn><span className="block">{`"`}</span><span className="block">{`'`}</span></KBtn>
        <KBtn className="w-[2.85rem] items-end justify-end pb-[2px] pr-[4px]" childrenClassName="items-end">
          return
        </KBtn>
      </div>

      {/* Fifth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-[3.65rem] items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">
          shift
        </KBtn>
        <KBtn><span className="block">Z</span></KBtn>
        <KBtn><span className="block">X</span></KBtn>
        <KBtn><span className="block">C</span></KBtn>
        <KBtn><span className="block">V</span></KBtn>
        <KBtn><span className="block">B</span></KBtn>
        <KBtn><span className="block">N</span></KBtn>
        <KBtn><span className="block">M</span></KBtn>
        <KBtn><span className="block">{`<`}</span><span className="block">{`,`}</span></KBtn>
        <KBtn><span className="block">{`>`}</span><span className="block">{`.`}</span></KBtn>
        <KBtn><span className="block">{`?`}</span><span className="block">{`/`}</span></KBtn>
        <KBtn className="w-[3.65rem] items-end justify-end pb-[2px] pr-[4px]" childrenClassName="items-end">
          shift
        </KBtn>
      </div>

      {/* sixth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1"><span className="block">fn</span></div>
          <div className="flex w-full justify-start pl-1"><IconWorld className="h-[6px] w-[6px]" /></div>
        </KBtn>
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1"><IconChevronUp className="h-[6px] w-[6px]" /></div>
          <div className="flex w-full justify-start pl-1"><span className="block">control</span></div>
        </KBtn>
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1"><OptionKey className="h-[6px] w-[6px]" /></div>
          <div className="flex w-full justify-start pl-1"><span className="block">option</span></div>
        </KBtn>
        <KBtn className="w-8" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-end pr-1"><IconCommand className="h-[6px] w-[6px]" /></div>
          <div className="flex w-full justify-start pl-1"><span className="block">command</span></div>
        </KBtn>
        <KBtn className="w-[8.2rem]" />
        <KBtn className="w-8" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-start pl-1"><IconCommand className="h-[6px] w-[6px]" /></div>
          <div className="flex w-full justify-start pl-1"><span className="block">command</span></div>
        </KBtn>
        <KBtn className="" childrenClassName="h-full justify-between py-[4px]">
          <div className="flex w-full justify-start pl-1"><OptionKey className="h-[6px] w-[6px]" /></div>
          <div className="flex w-full justify-start pl-1"><span className="block">option</span></div>
        </KBtn>
        <div className="mt-[2px] flex h-6 w-[4.9rem] flex-col items-center justify-end rounded-[4px] p-[0.5px]">
          <KBtn className="h-3 w-6"><IconCaretUpFilled className="h-[6px] w-[6px]" /></KBtn>
          <div className="flex">
            <KBtn className="h-3 w-6"><IconCaretLeftFilled className="h-[6px] w-[6px]" /></KBtn>
            <KBtn className="h-3 w-6"><IconCaretDownFilled className="h-[6px] w-[6px]" /></KBtn>
            <KBtn className="h-3 w-6"><IconCaretRightFilled className="h-[6px] w-[6px]" /></KBtn>
          </div>
        </div>
      </div>
    </div>
  );
};

export const KBtn = ({
  className,
  children,
  childrenClassName,
  backlit = true,
}: {
  className?: string;
  children?: React.ReactNode;
  childrenClassName?: string;
  backlit?: boolean;
}) => {
  return (
    <div
      className={cn(
        "[transform:translateZ(0)] rounded-[4px] p-[0.5px] [will-change:transform]",
        backlit && "bg-white/[0.2] shadow-xl shadow-white",
      )}
    >
      <div
        className={cn("flex h-6 w-6 items-center justify-center rounded-[3.5px] bg-[#0A090D]", className)}
        style={{ boxShadow: "0px -0.5px 2px 0 #0D0D0F inset, -0.5px 0px 2px 0 #0D0D0F inset" }}
      >
        <div
          className={cn(
            "flex w-full flex-col items-center justify-center text-[5px] text-neutral-200",
            childrenClassName,
            backlit && "text-white",
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
};

export const SpeakerGrid = () => {
  return (
    <div
      className="mt-2 flex h-40 gap-[2px] px-[0.5px]"
      style={{ backgroundImage: "radial-gradient(circle, #08080A 0.5px, transparent 0.5px)", backgroundSize: "3px 3px" }}
    />
  );
};

export const OptionKey = ({ className }: { className: string }) => {
  return (
    <svg fill="none" version="1.1" id="icon" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" className={className}>
      <rect stroke="currentColor" strokeWidth={2} x="18" y="5" width="10" height="2" />
      <polygon stroke="currentColor" strokeWidth={2} points="10.6,5 4,5 4,7 9.4,7 18.4,27 28,27 28,25 19.6,25 " />
      <rect id="_Transparent_Rectangle_" className="st0" width="32" height="32" stroke="none" />
    </svg>
  );
};

/* Umbra's half-disc mark on the closed lid (replaces the Aceternity logo). */
const UmbraMark = () => {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3.5 w-3.5">
      <circle cx="12" cy="12" r="9" stroke="#5eead4" strokeWidth="2" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="#5eead4" />
    </svg>
  );
};
