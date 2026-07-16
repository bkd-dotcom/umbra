import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

/** Merge Tailwind class names with conflict resolution — the util every
 *  Aceternity component imports. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
