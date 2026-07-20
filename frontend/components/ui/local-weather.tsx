"use client";

import { useEffect, useState } from "react";

// A small, comfortable header chip: the user's local time and current weather.
// Everything here is best-effort and client-only — location is resolved from the
// IP (no GPS permission prompt), weather comes from Open-Meteo (free, no API key).
// Any failure silently degrades to just the browser-local clock, or nothing; it
// never blocks paint and never renders an error.

type Weather = { temp: number; unit: string; label: string; emoji: string };
type Geo = { lat: number; lon: number; tz?: string; us?: boolean };

// WMO weather codes (Open-Meteo) → a friendly emoji + short label.
function describe(code: number): { emoji: string; label: string } {
  if (code === 0) return { emoji: "☀️", label: "Clear" };
  if (code === 1 || code === 2) return { emoji: "🌤️", label: "Partly cloudy" };
  if (code === 3) return { emoji: "☁️", label: "Overcast" };
  if (code === 45 || code === 48) return { emoji: "🌫️", label: "Fog" };
  if ([51, 53, 55, 56, 57].includes(code)) return { emoji: "🌦️", label: "Drizzle" };
  if ([61, 63, 65, 66, 67, 80, 81, 82].includes(code)) return { emoji: "🌧️", label: "Rain" };
  if ([71, 73, 75, 77, 85, 86].includes(code)) return { emoji: "❄️", label: "Snow" };
  if ([95, 96, 99].includes(code)) return { emoji: "⛈️", label: "Storm" };
  return { emoji: "🌡️", label: "" };
}

async function fetchJson(url: string): Promise<Record<string, unknown> | null> {
  try {
    const r = await fetch(url);
    return r.ok ? ((await r.json()) as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

// Resolve approximate location from the IP. Several free, no-key, CORS-enabled
// providers are tried in order because any single one rate-limits (ipapi.co in
// particular returns HTTP 200 with an *error body* — no coordinates — once
// throttled, which silently killed the weather lookup). We accept the first
// response that yields finite coordinates.
async function resolveGeo(): Promise<Geo | null> {
  // ipwho.is → { latitude, longitude, timezone: {id}, country_code, success }
  const a = await fetchJson("https://ipwho.is/");
  if (a && a.success !== false) {
    const lat = Number(a.latitude);
    const lon = Number(a.longitude);
    const tz = (a.timezone as { id?: string } | undefined)?.id;
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, tz, us: a.country_code === "US" };
  }
  // geojs → { latitude, longitude, timezone, country_code } (strings)
  const b = await fetchJson("https://get.geojs.io/v1/ip/geo.json");
  if (b) {
    const lat = Number(b.latitude);
    const lon = Number(b.longitude);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon, tz: b.timezone as string | undefined, us: b.country_code === "US" };
  }
  // ipapi.co → { latitude, longitude, timezone, country_code } (may be throttled)
  const c = await fetchJson("https://ipapi.co/json/");
  if (c) {
    const lat = Number(c.latitude);
    const lon = Number(c.longitude);
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
    const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    setTz(browserTz); // show the clock immediately from the browser timezone
    (async () => {
      const geo = await resolveGeo();
      if (cancelled || !geo) return;
      if (geo.tz) setTz(geo.tz);
      const unit = geo.us ? "fahrenheit" : "celsius";
      const wx = await fetchJson(
        `https://api.open-meteo.com/v1/forecast?latitude=${geo.lat}&longitude=${geo.lon}&current=temperature_2m,weather_code&temperature_unit=${unit}`,
      );
      if (cancelled) return;
      const current = wx?.current as { temperature_2m?: number; weather_code?: number } | undefined;
      if (current?.temperature_2m == null) return;
      setWeather({ temp: Math.round(current.temperature_2m), unit: unit === "fahrenheit" ? "°F" : "°C", ...describe(Number(current.weather_code)) });
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

  return (
    <div
      className={`hidden items-center gap-2 rounded-full border border-[color:var(--surface-border)] bg-[color:var(--surface-2)] px-3 py-1.5 font-mono text-[11px] text-fog backdrop-blur-sm sm:flex ${className}`}
      title={`${weather?.label || "Local time"} · weather for your approximate location`}
    >
      {weather && <span className="text-[13px] leading-none" aria-hidden>{weather.emoji}</span>}
      {weather && <span className="text-cloud">{weather.temp}{weather.unit}</span>}
      {weather && <span className="text-fog/40">·</span>}
      <span className="text-cloud">{time}</span>
    </div>
  );
}
