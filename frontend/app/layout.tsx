import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Umbra HQ · Night Shift",
  description: "The AI engineer that works the night shift.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}

