"use client";

import { useEffect, useState } from "react";

// Ambient "night shift" chrome: the viewer's local time, and — when genuinely
// sourced — the local weather. This is DELIBERATELY low-emphasis and visually
// distinct from operational status (SHIFT FILED / LIVE / scan progress / provider
// state / auth): a subdued neutral surface, muted text, and a moon glyph so it
// reads as ambient context, never as system evidence.
//
// Everything is best-effort and client-only — location is resolved from the IP
// (no GPS prompt), weather from Open-Meteo (free, no key). Any failure silently
// degrades to just the local clock, or nothing; it never blocks paint or errors.

type Weather = { temp: number; unit: string };
type Geo = { lat: number; lon: number; tz?: string; us?: boolean };

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Resolve approximate location from the IP. Several free, no-key, CORS-enabled
// providers are tried in order because any single one rate-limits. We accept the
// first response that yields finite coordinates.
async function resolveGeo(): Promise<Geo | null> {
  const a = await fetchJson("https://ipwho.is/");
  if (a && a.success !== false) {
    const lat = Number(a.latitude), lon = Number(a.longitude);
    const tz = (a.timezone as { id?: string } | undefined)?.id;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, tz, us: a.country_code === "US" };
  }
  const b = await fetchJson("https://get.geojs.io/v1/ip/geo.json");
  if (b) {
    const lat = Number(b.latitude), lon = Number(b.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, tz: b.timezone as string | undefined, us: b.country_code === "US" };
  }
  const c = await fetchJson("https://ipapi.co/json/");
  if (c) {
    const lat = Number(c.latitude), lon = Number(c.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, tz: c.timezone as string | undefined, us: c.country_code === "US" };
  }
  return null;
}

export function LocalWeather({ className = "" }: { className?: string }) {
  const [tz, setTz] = useState<string | undefined>(undefined);
  const [weather, setWeather] = useState<Weather | null>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    let cancelled = false;
    setTz(Intl.DateTimeFormat().resolvedOptions().timeZone); // clock immediately
    (async () => {
      const geo = await resolveGeo();
      if (cancelled || !geo) return;
      if (geo.tz) setTz(geo.tz);
      const unit = geo.us ? "fahrenheit" : "celsius";
      const wx = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m&temperature_unit=${unit}`,
      );
      if (cancelled) return;
      const current = wx?.current as { temperature_2m?: number } | undefined;
      // Only render weather when it is GENUINELY sourced (a finite temperature).
      if (current?.temperature_2m == null || !Number.isFinite(current.temperature_2m)) return;
      setWeather({ temp: Math.round(current.temperature_2m), unit: unit === "fahrenheit" ? "°F" : "°C" });
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tick = () => {
      try {
        setTime(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: tz || undefined }).format(new Date()));
      } catch {
        setTime(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()));
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [tz]);

  if (!time) return null; // nothing resolved yet — stay invisible, never block paint

  const label = weather ? "Local time and weather" : "Local time";
  return (
    <div
      className={`hidden items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-[11px] text-fog sm:flex ${className}`}
      style={{ background: "color-mix(in oklab, var(--color-fog) 8%, transparent)" }}
      aria-label={label}
      title={label}
    >
      <span className="text-[12px] leading-none text-fog/70" aria-hidden>☾</span>
      {weather && <span className="tabular-nums text-fog">{weather.temp}{weather.unit}</span>}
      {weather && <span className="text-fog/40" aria-hidden>·</span>}
      <span className="tabular-nums text-fog">{time}</span>
      <span className="text-fog">local</span>
    </div>
  );
}
