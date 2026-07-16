"use client";

import { motion } from "motion/react";
import { EASE } from "@/lib/motion";

/** Per-route transition: content fades in on navigation (landing ↔ dashboard)
 *  instead of hard-cutting. Opacity-only on purpose — a translate here would put
 *  a transform on the whole-page scroll wrapper, which hitches the first scroll
 *  and reparents the sticky header. Runs on every route change. */
export default function Template({ children }: { children: React.ReactNode }) {
  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.4, ease: EASE }}
    >
      {children}
    </motion.div>
  );
}
