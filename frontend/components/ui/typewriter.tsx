"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useReducedMotion } from "motion/react";

/* Typewriter that cycles through phrases with a blinking caret and an OPTIONAL
   keystroke sound. Sound is OFF by default (browsers block autoplay audio, and a
   forced click track is hostile) — a small speaker toggle enables it, and the
   toggle click doubles as the required user gesture to start the AudioContext.
   Under prefers-reduced-motion it renders the first phrase statically, no sound. */
export function Typewriter({
  phrases,
  className,
  caretClassName,
  typingMs = 46,
  deletingMs = 26,
  holdMs = 1500,
  showSoundToggle = true,
}: {
  phrases: string[];
  className?: string;
  caretClassName?: string;
  typingMs?: number;
  deletingMs?: number;
  holdMs?: number;
  showSoundToggle?: boolean;
}) {
  const reduce = useReducedMotion();
  const [text, setText] = useState("");
  const [phase, setPhase] = useState(0);
  const [deleting, setDeleting] = useState(false);
  const [muted, setMuted] = useState(true);
  const audioRef = useRef<AudioContext | null>(null);

  // A mechanical key CLACK per keystroke: a short filtered-noise burst (the "click")
  // layered with a low triangle "thock" (the body) — not a tonal beep. Synthesized,
  // so no audio asset is shipped.
  const blip = useCallback(() => {
    if (muted || reduce) return;
    const ctx = audioRef.current;
    if (!ctx) return;
    const now = ctx.currentTime;
    // Noise burst → bandpass → fast decay = the plastic "click".
    const dur = 0.028;
    const buffer = ctx.createBuffer(1, Math.max(1, Math.floor(ctx.sampleRate * dur)), ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / data.length);
    const noise = ctx.createBufferSource();
    noise.buffer = buffer;
    const bp = ctx.createBiquadFilter();
    bp.type = "bandpass";
    bp.frequency.value = 1700 + Math.random() * 500;
    bp.Q.value = 0.7;
    const ng = ctx.createGain();
    ng.gain.setValueAtTime(0.22, now);
    ng.gain.exponentialRampToValueAtTime(0.0008, now + dur);
    noise.connect(bp).connect(ng).connect(ctx.destination);
    noise.start(now);
    noise.stop(now + dur);
    // Low "thock" for mechanical body.
    const osc = ctx.createOscillator();
    osc.type = "triangle";
    osc.frequency.value = 130 + Math.random() * 30;
    const og = ctx.createGain();
    og.gain.setValueAtTime(0.11, now);
    og.gain.exponentialRampToValueAtTime(0.0008, now + 0.02);
    osc.connect(og).connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.022);
  }, [muted, reduce]);

  useEffect(() => {
    if (reduce) { setText(phrases[0] ?? ""); return; }
    const full = phrases[phase % phrases.length] ?? "";
    // Clean state machine: type → hold → delete → next phrase.
    if (!deleting && text === full) {
      const t = setTimeout(() => setDeleting(true), holdMs);
      return () => clearTimeout(t);
    }
    if (deleting && text === "") {
      setDeleting(false);
      setPhase((p) => (p + 1) % phrases.length);
      return;
    }
    if (deleting) {
      const t = setTimeout(() => setText(full.slice(0, text.length - 1)), deletingMs);
      return () => clearTimeout(t);
    }
    const t = setTimeout(() => { setText(full.slice(0, text.length + 1)); blip(); }, typingMs);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [text, phase, deleting, reduce]);

  const toggleSound = () => {
    if (muted) {
      try {
        audioRef.current = audioRef.current || new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
        void audioRef.current.resume();
      } catch { /* Web Audio unavailable — stay muted */ }
    }
    setMuted((m) => !m);
  };

  return (
    <span className="inline-flex items-center gap-2">
      <span className={className} aria-live="polite">{text || " "}</span>
      {!reduce && <span className={caretClassName ?? "inline-block h-[1em] w-[2px] translate-y-[0.12em] animate-pulse-glow bg-cyan"} aria-hidden />}
      {showSoundToggle && !reduce && (
        <button
          onClick={toggleSound}
          aria-label={muted ? "Enable typing sound" : "Mute typing sound"}
          className="ml-1 grid h-6 w-6 place-items-center rounded-full border border-[color:var(--surface-border)] text-fog transition-colors hover:text-cloud"
        >
          {muted ? <MuteIcon /> : <SoundIcon />}
        </button>
      )}
    </span>
  );
}

const SoundIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="M16 8.5a4 4 0 0 1 0 7" />
  </svg>
);
const MuteIcon = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="h-3.5 w-3.5" aria-hidden>
    <path d="M4 9v6h4l5 4V5L8 9H4Z" /><path d="m16 9 5 6M21 9l-5 6" />
  </svg>
);
