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

const DESCRIPTION =
  "Umbra is an autonomous AI engineering crew for your GitHub repo, built for OpenAI Build Week. Codex CLI proposes fix diffs inside a disposable clone (never auto-merged), GPT‑5.6 reasons over real repo evidence, and a provider ledger labels every output live / cache / unavailable — so the night crew hunts CVEs, traces incidents, and answers your codebase while you sleep.";

// If an OG share image is added later, drop it at /public/og.png (1200×630) and
// set `images: ["/og.png"]` on both openGraph and twitter below.
export const metadata: Metadata = {
  metadataBase: new URL("https://umbra.engineer"),
  title: "Umbra — the AI engineer that works the night shift",
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: "https://umbra.engineer",
    siteName: "Umbra",
    title: "Umbra — the AI engineer that works the night shift",
    description: DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Umbra — the AI engineer that works the night shift",
    description: DESCRIPTION,
  },
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
