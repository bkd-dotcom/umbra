import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // Emit a fully static bundle (out/) so the FastAPI backend can serve the
  // dashboard from the same origin — one service, one URL, no CORS. The page
  // is 100% client-rendered, so nothing here needs a Node server at runtime.
  output: "export",
  images: { unoptimized: true },
};

export default nextConfig;

