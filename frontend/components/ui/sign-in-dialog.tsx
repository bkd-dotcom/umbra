"use client";

import { useEffect } from "react";
import { AnimatePresence, motion } from "motion/react";
import { EASE } from "@/lib/motion";
import { GitHubIcon, GoogleIcon } from "./icons";

/** Animated modal that presents GitHub and Google as EQUAL sign-in choices —
 *  replaces the old nav button that jumped straight to GitHub. */
export function SignInDialog({ open, onClose, api }: { open: boolean; onClose: () => void; api: string }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    if (open) document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 grid place-items-center p-5"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <div className="absolute inset-0 bg-ink/80 backdrop-blur-sm" />
          <motion.div
            role="dialog"
            aria-modal
            aria-label="Sign in to Umbra"
            className="relative w-[min(420px,100%)] overflow-hidden rounded-3xl border border-[color:var(--surface-border)] bg-ink-2/90 p-8 shadow-2xl"
            initial={{ opacity: 0, scale: 0.94, y: 16 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 10 }}
            transition={{ duration: 0.35, ease: EASE }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-1 text-center font-serif text-2xl">Welcome to Umbra</div>
            <p className="mb-6 text-center text-sm text-fog">Sign in to point the night crew at your repositories.</p>
            <div className="flex flex-col gap-3">
              <a
                href={`${api}/auth/login/github`}
                className="flex items-center justify-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-5 py-3.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:border-violet/50 hover:shadow-[0_0_30px_-6px_rgba(167,139,250,0.5)]"
              >
                <GitHubIcon /> Continue with GitHub
              </a>
              <a
                href={`${api}/auth/login/google`}
                className="flex items-center justify-center gap-3 rounded-xl border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-5 py-3.5 text-sm font-medium transition-all duration-300 hover:-translate-y-0.5 hover:border-cyan/50 hover:shadow-[0_0_30px_-6px_rgba(34,211,238,0.5)]"
              >
                <GoogleIcon /> Continue with Google
              </a>
            </div>
            <p className="mt-6 text-center text-xs leading-relaxed text-fog">
              GitHub unlocks live scans of your own public & private repos. Google users can connect GitHub after signing in.
            </p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
