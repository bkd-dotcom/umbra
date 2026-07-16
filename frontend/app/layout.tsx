import type { Metadata } from "next";
import { Inter, Instrument_Serif, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import { SmoothScroll } from "@/components/ui/smooth-scroll";
import { ThemeToggle } from "@/components/ui/theme-toggle";

// Set the saved theme before first paint so there's no flash (default: dark).
const NO_FLASH = `(function(){try{var t=localStorage.getItem('umbra-theme');document.documentElement.dataset.theme=(t==='light'?'light':'dark');}catch(e){document.documentElement.dataset.theme='dark';}})();`;

// Editorial serif display (the high-end / Anthropic-calm touch) + a clean
// geometric sans for UI + mono for the honesty ledger and terminal.
const sans = Inter({ subsets: ["latin"], variable: "--ff-sans", display: "swap" });
const serif = Instrument_Serif({ subsets: ["latin"], weight: "400", style: ["normal", "italic"], variable: "--ff-serif", display: "swap" });
const mono = JetBrains_Mono({ subsets: ["latin"], variable: "--ff-mono", display: "swap" });

export const metadata: Metadata = {
  title: "Umbra — the AI engineer that works the night shift",
  description: "An autonomous AI engineering team for your GitHub repo. Sign in and watch the night crew hunt CVEs, trace incidents, and answer your codebase — while you sleep.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" data-theme="dark" className={`${sans.variable} ${serif.variable} ${mono.variable}`}>
      <head>
        <script dangerouslySetInnerHTML={{ __html: NO_FLASH }} />
      </head>
      <body className="antialiased">
        {/* Shared, fixed base gradient for the whole site (no seam behind the
            centered column). Each page layers its OWN animated background on top:
            the landing gets an expressive drifting Aurora, the dashboard a calm
            drifting dot-grid — so the two surfaces feel distinct. */}
        <div className="bg-fx" aria-hidden />
        <ThemeToggle />
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
