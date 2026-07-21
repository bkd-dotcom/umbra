"use client";

import { useEffect, useRef } from "react";

/* Accessible modal behavior for the dashboard's motion-based overlays without
   rebuilding them: adds Escape-to-close, a focus trap, and focus restore, and
   returns props to spread on the dialog surface (role=dialog, aria-modal). Pair
   with the existing backdrop onClick={onClose}.

   Usage:
     const { dialogProps } = useModalA11y(open, onClose, "Open a pull request");
     <motion.div {...dialogProps} ...>
*/
export function useModalA11y(open: boolean, onClose: () => void, label: string) {
  const ref = useRef<HTMLDivElement>(null);
  const lastFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;
    lastFocused.current = (document.activeElement as HTMLElement) ?? null;
    const node = ref.current;

    // Move focus into the dialog (first focusable, else the surface itself).
    const focusables = () =>
      node
        ? Array.from(
            node.querySelectorAll<HTMLElement>(
              'a[href],button:not([disabled]),textarea,input,select,[tabindex]:not([tabindex="-1"])',
            ),
          ).filter((el) => el.offsetParent !== null)
        : [];
    const first = focusables()[0];
    (first ?? node)?.focus();

    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === "Tab" && node) {
        const items = focusables();
        if (items.length === 0) {
          e.preventDefault();
          return;
        }
        const firstEl = items[0];
        const lastEl = items[items.length - 1];
        if (e.shiftKey && document.activeElement === firstEl) {
          e.preventDefault();
          lastEl.focus();
        } else if (!e.shiftKey && document.activeElement === lastEl) {
          e.preventDefault();
          firstEl.focus();
        }
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      // Restore focus to whatever opened the modal.
      lastFocused.current?.focus?.();
    };
  }, [open, onClose]);

  return {
    dialogProps: {
      ref,
      role: "dialog" as const,
      "aria-modal": true as const,
      "aria-label": label,
      tabIndex: -1,
    },
  };
}
