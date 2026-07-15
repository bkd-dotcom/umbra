import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";

// Editorial serif display (the high-end / Anthropic-calm touch) + a clean
// geometric sans for UI + mono for the honesty ledger and terminal.
const sans = Inter({ subsets: ["latin"], variable: "--font-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--font-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Umbra — the AI engineer that works the night shift",
  description: "An autonomous AI engineering team for your GitHub repo. Sign in and watch the night crew hunt CVEs, trace incidents, and answer your codebase — while you sleep.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
