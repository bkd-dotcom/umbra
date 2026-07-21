"use client";
import React, { useEffect, useRef, useState } from "react";
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

/* Faithful adaptation of Aceternity's official "Macbook Scroll" component
   (registry: @aceternity/macbook-scroll). The hierarchy and transform mapping are
   the official ones — outer scale-gated scene (0.35 → 1), Lid = a folded-back
   panel plus an absolutely-positioned screen that unfolds about its top hinge
   (rotateX) and scales forward while translating, over a `-z-10` Base keyboard
   sibling. Only the CONTENT is substituted for Umbra: the screen shows the
   morning-report image, the closed-lid logo is Umbra's mark, and the base is dark
   by default (Umbra uses a data-theme system, so the original `dark:` class never
   fires — the dark value is applied directly). Interaction is unchanged.

   Reduced-motion renders a stable, fully-open, coherent device with the report
   readable and no scroll-linked transforms. */
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
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReducedMotion();
  const { scrollYProgress } = useScroll({
    target: ref,
    offset: ["start start", "end start"],
  });

  // Viewport tier — the raw registry values are desktop-only; mobile/tablet need
  // their own scale + (much smaller) translate so the report stays attached to the
  // laptop rather than flying ~1500px away. Desktop mapping is unchanged.
  const [tier, setTier] = useState<"mobile" | "tablet" | "desktop">("desktop");
  useEffect(() => {
    if (typeof window === "undefined") return;
    const compute = () => {
      const w = window.innerWidth;
      setTier(w < 768 ? "mobile" : w < 1024 ? "tablet" : "desktop");
    };
    compute();
    window.addEventListener("resize", compute);
    return () => window.removeEventListener("resize", compute);
  }, []);

  // Final scale of the open screen. Desktop is pinned (no lift), so the scale must
  // fit the sticky stage below the nav without the tall open screen clipping above
  // the viewport — 1.25 reads large and premium while staying fully in frame.
  const finalScale = tier === "desktop" ? 1.25 : tier === "tablet" ? 1.35 : 1.2;
  // Desktop lifts the screen far (official). On small screens we PIN the device in
  // a sticky stage instead (below), so there is NO lift — the report never drifts
  // up behind the sticky nav and never leaves the device context.
  const liftPx = 0;

  // All tiers now PIN the device in a sticky stage sized to the open composition and
  // open it IN PLACE (scale + un-rotate), with NO upward lift. This guarantees the
  // laptop/report never translates out of its own section into the next one — the
  // screen finishes opening and holds, then the sticky releases cleanly into the
  // following section. Desktop keeps its larger scale/scene; only the runaway lift
  // that pushed the open screen into Crew is removed.
  const openEnd = tier === "desktop" ? 0.38 : 0.4;
  const scaleX = useTransform(scrollYProgress, [0, openEnd], [1.2, finalScale]);
  const scaleY = useTransform(scrollYProgress, [0, openEnd], [0.6, finalScale]);
  const translate = useTransform(scrollYProgress, [0, openEnd], [0, liftPx]);
  const rotate = useTransform(scrollYProgress, [0.1 * (openEnd / 0.3), 0.12 * (openEnd / 0.3), openEnd], [-28, -28, 0]);
  const textOpacity = useTransform(scrollYProgress, [0, 0.2], [1, 0]);

  // Reduced-motion: a stable, fully-open device (no pinned track, no scroll
  // transforms) — the lid sits open at rest and the report is fully readable.
  if (reduce) {
    return (
      <div className="flex shrink-0 scale-[0.6] flex-col items-center justify-start py-8 [perspective:800px] sm:scale-75 md:scale-100 md:py-20" aria-hidden>
        {title && <div className="mb-8 text-center">{title}</div>}
        <StaticLid src={src} />
        <BaseArea showGradient={showGradient} badge={badge} />
      </div>
    );
  }

  // --- Mobile / tablet (<1024px): PINNED stage --------------------------------
  // A short track with a `sticky` stage cleared below the 80px nav. The stage is
  // sized to the laptop/report COMPOSITION (not the viewport), has NO background of
  // its own (the shared document background shows through — no dark rectangle), and
  // the pin travel is only long enough to play the open. The open completes
  // (openEnd≈0.4) just before the sticky releases, so the final report is fully
  // visible and Crew follows with normal clamp spacing — no dead panel, no gap.
  if (tier !== "desktop") {
    return (
      <div
        ref={ref}
        className="relative isolate"
        aria-hidden
        // Track = stage height (fits composition) + a short pin travel (40vh).
        style={{ height: "calc(clamp(340px, 52vh, 560px) + 40vh)" }}
      >
        <div className="sticky top-[80px] flex h-[clamp(340px,52vh,560px)] flex-col items-center justify-center [perspective:800px]">
          <motion.div style={{ opacity: textOpacity }} className="mb-6 px-4 text-center">
            {title}
          </motion.div>
          <div className="flex scale-[0.6] flex-col items-center sm:scale-[0.78]">
            <Lid src={src} scaleX={scaleX} scaleY={scaleY} rotate={rotate} translate={translate} />
            <BaseArea showGradient={showGradient} badge={badge} />
          </div>
        </div>
      </div>
    );
  }

  // --- Desktop (≥1024px): PINNED stage (same open-in-place mechanic as small
  // screens, at the larger desktop scale). The device opens in a sticky stage and
  // the sticky RELEASES into the next section — the open screen no longer lifts
  // 1500px into Crew. The lid still scales/un-rotates exactly as before; only the
  // runaway upward translate is gone. Stage height fits the open composition; the
  // track adds a modest pin travel so the open plays over real scroll, then clears.
  return (
    <div
      ref={ref}
      className="relative isolate"
      aria-hidden
      style={{ height: "calc(clamp(520px, 72vh, 760px) + 55vh)" }}
    >
      {/* Title sits ABOVE the device in normal flow (never absolutely over it), so
          the handoff copy can't overlap the laptop screen. The stage is top-aligned
          with a top offset that clears the nav; the device follows below with a gap. */}
      <div className="sticky top-24 flex h-[clamp(520px,72vh,760px)] flex-col items-center justify-start gap-8 pt-10 [perspective:800px]">
        <motion.div style={{ opacity: textOpacity }} className="px-4 text-center">
          {title}
        </motion.div>
        <div className="flex flex-col items-center">
          <Lid src={src} scaleX={scaleX} scaleY={scaleY} rotate={rotate} translate={translate} />
          <BaseArea showGradient={showGradient} badge={badge} />
        </div>
      </div>
    </div>
  );
};

/* The keyboard base — the official Base area, dark by default (Umbra dark theme).
   `-z-10` so the unfolding lid paints over it, exactly like the reference; they
   are stacked siblings at the same width, so they read as one device. */
const BaseArea = ({ showGradient, badge }: { showGradient?: boolean; badge?: React.ReactNode }) => {
  return (
    <div className="relative -z-10 h-[22rem] w-[32rem] overflow-hidden rounded-2xl bg-[#272729]">
      {/* above keyboard bar */}
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
      {/* No page-colored bottom fade: it created a light/dark smudge at the base in
          light mode and clipped the keyboard in dark mode. The rounded, self-
          contained dark base grounds cleanly on either theme without an overlay. */}
      {badge && <div className="absolute bottom-4 left-4">{badge}</div>}
    </div>
  );
};

export const Lid = ({
  scaleX,
  scaleY,
  rotate,
  translate,
  src,
}: {
  scaleX: MotionValue<number>;
  scaleY: MotionValue<number>;
  rotate: MotionValue<number>;
  translate: MotionValue<number>;
  src?: string;
}) => {
  return (
    <div className="relative [perspective:800px]">
      <div
        style={{
          transform: "perspective(800px) rotateX(-25deg) translateZ(0px)",
          transformOrigin: "bottom",
          transformStyle: "preserve-3d",
        }}
        className="relative h-[12rem] w-[32rem] rounded-2xl bg-[#010101] p-2"
      >
        <div
          style={{ boxShadow: "0px 2px 0px 2px #171717 inset" }}
          className="absolute inset-0 flex items-center justify-center rounded-lg bg-[#010101]"
        >
          <span className="text-white">
            <UmbraMark />
          </span>
        </div>
      </div>
      <motion.div
        style={{
          scaleX,
          scaleY,
          rotateX: rotate,
          translateY: translate,
          transformStyle: "preserve-3d",
          transformOrigin: "top",
        }}
        className="absolute inset-0 h-96 w-[32rem] rounded-2xl bg-[#010101] p-2"
      >
        <div className="absolute inset-0 rounded-lg bg-[#272729]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Umbra morning report — findings, the Codex-prepared diff, and what still needs review" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full rounded-lg object-cover object-left-top" />
      </motion.div>
    </div>
  );
};

/* A static, fully-open lid for the reduced-motion fallback (no motion values). */
const StaticLid = ({ src }: { src?: string }) => {
  return (
    <div className="relative [perspective:800px]">
      <div
        style={{ transform: "perspective(800px) rotateX(-25deg) translateZ(0px)", transformOrigin: "bottom" }}
        className="relative h-[12rem] w-[32rem] rounded-2xl bg-[#010101] p-2"
      >
        <div style={{ boxShadow: "0px 2px 0px 2px #171717 inset" }} className="absolute inset-0 flex items-center justify-center rounded-lg bg-[#010101]">
          <span className="text-white"><UmbraMark /></span>
        </div>
      </div>
      <div className="absolute inset-0 h-96 w-[32rem] rounded-2xl bg-[#010101] p-2" style={{ transformOrigin: "top" }}>
        <div className="absolute inset-0 rounded-lg bg-[#272729]" />
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt="Umbra morning report — findings, the Codex-prepared diff, and what still needs review" loading="lazy" decoding="async" className="absolute inset-0 h-full w-full rounded-lg object-cover object-left-top" />
      </div>
    </div>
  );
};

export const Trackpad = () => {
  return (
    <div className="mx-auto my-1 h-32 w-[40%] rounded-xl" style={{ boxShadow: "0px 0px 1px 1px #00000020 inset" }} />
  );
};

export const Keypad = () => {
  return (
    <div className="mx-1 h-full [transform:translateZ(0)] rounded-md bg-[#050505] p-1 [will-change:transform]">
      {/* First Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-10 items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">esc</KBtn>
        <KBtn><IconBrightnessDown className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F1</span></KBtn>
        <KBtn><IconBrightnessUp className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F2</span></KBtn>
        <KBtn><IconTable className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F3</span></KBtn>
        <KBtn><IconSearch className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F4</span></KBtn>
        <KBtn><IconMicrophone className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F5</span></KBtn>
        <KBtn><IconMoon className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F6</span></KBtn>
        <KBtn><IconPlayerTrackPrev className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F7</span></KBtn>
        <KBtn><IconPlayerSkipForward className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F8</span></KBtn>
        <KBtn><IconPlayerTrackNext className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F9</span></KBtn>
        <KBtn><IconVolume3 className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F10</span></KBtn>
        <KBtn><IconVolume2 className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F11</span></KBtn>
        <KBtn><IconVolume className="h-[6px] w-[6px]" /><span className="mt-1 inline-block">F12</span></KBtn>
        <KBtn><div className="h-4 w-4 rounded-full bg-gradient-to-b from-neutral-900 from-20% via-black via-50% to-neutral-900 to-95% p-px"><div className="h-full w-full rounded-full bg-black" /></div></KBtn>
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
        <KBtn className="w-10 items-end justify-end pr-[4px] pb-[2px]" childrenClassName="items-end">delete</KBtn>
      </div>
      {/* Third row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-10 items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">tab</KBtn>
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
        <KBtn className="w-[2.8rem] items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">caps lock</KBtn>
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
        <KBtn className="w-[2.85rem] items-end justify-end pr-[4px] pb-[2px]" childrenClassName="items-end">return</KBtn>
      </div>
      {/* Fifth Row */}
      <div className="mb-[2px] flex w-full shrink-0 gap-[2px]">
        <KBtn className="w-[3.65rem] items-end justify-start pb-[2px] pl-[4px]" childrenClassName="items-start">shift</KBtn>
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
        <KBtn className="w-[3.65rem] items-end justify-end pr-[4px] pb-[2px]" childrenClassName="items-end">shift</KBtn>
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
    <div className={cn("[transform:translateZ(0)] rounded-[4px] p-[0.5px] [will-change:transform]", backlit && "bg-white/[0.2] shadow-xl shadow-white")}>
      <div
        className={cn("flex h-6 w-6 items-center justify-center rounded-[3.5px] bg-[#0A090D]", className)}
        style={{ boxShadow: "0px -0.5px 2px 0 #0D0D0F inset, -0.5px 0px 2px 0 #0D0D0F inset" }}
      >
        <div className={cn("flex w-full flex-col items-center justify-center text-[5px] text-neutral-200", childrenClassName, backlit && "text-white")}>
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

/* Umbra's eclipse-aperture mark on the closed lid (replaces the Aceternity logo). */
const UmbraMark = () => {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg" className="h-3 w-3">
      <circle cx="12" cy="12" r="9" stroke="#22d3ee" strokeWidth="2" />
      <path d="M12 3a9 9 0 0 1 0 18Z" fill="#22d3ee" />
    </svg>
  );
};
