"use client";

import { motion } from "motion/react";
import { cn } from "@/lib/utils";

/** Aceternity "Stateful Button" — a primary action that shows a spinner while
 *  loading and stays disabled. */
export function StatefulButton({
  children,
  loading,
  disabled,
  onClick,
  className,
}: {
  children: React.ReactNode;
  loading?: boolean;
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <motion.button
      whileTap={{ scale: 0.97 }}
      onClick={onClick}
      disabled={disabled || loading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-b from-cyan/90 to-violet/90 px-5 py-3 text-sm font-semibold text-ink shadow-[0_10px_30px_-8px_rgba(34,211,238,0.5)] transition-all duration-300 hover:shadow-[0_14px_40px_-8px_rgba(167,139,250,0.6)] disabled:cursor-not-allowed disabled:opacity-60",
        className,
      )}
    >
      {loading && (
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-ink/40 border-t-ink" />
      )}
      {children}
    </motion.button>
  );
}
