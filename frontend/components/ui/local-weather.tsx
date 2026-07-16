"use client";

import { useEffect, useState } from "react";

// A small, comfortable header chip: the user's local time and current weather.
// Everything here is best-effort and client-only — location is resolved from the
// IP (no GPS permission prompt), weather comes from Open-Meteo (free, no API key).
// Any failure silently degrades to just the browser-local clock, or nothing; it
// never blocks paint and never renders an error.

type Weather = { temp: number; unit: string; label: string; emoji: string };
type Place = { city?: string; tz?: string };

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

export function LocalWeather({ className = "" }: { className?: string }) {
  const [place, setPlace] = useState<Place>({});
  const [weather, setWeather] = useState<Weather | null>(null);
  const [time, setTime] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const browserTz = Intl.DateTimeFormat().resolvedOptions().timeZone;
      try {
        const geo = await fetch("https://ipapi.co/json/").then((r) => (r.ok ? r.json() : null));
        if (cancelled) return;
        setPlace({ city: geo?.city, tz: geo?.timezone || browserTz });
        if (geo?.latitude != null && geo?.longitude != null) {
          const unit = geo?.country_code === "US" ? "fahrenheit" : "celsius";
          const wx = await fetch(
            `https://api.open-meteo.com/v1/forecast?latitude=${geo.latitude}&longitude=${geo.longitude}&current=temperature_2m,weather_code&temperature_unit=${unit}`,
          ).then((r) => (r.ok ? r.json() : null));
          if (cancelled || !wx?.current) return;
          setWeather({ temp: Math.round(wx.current.temperature_2m), unit: unit === "fahrenheit" ? "°F" : "°C", ...describe(Number(wx.current.weather_code)) });
        }
      } catch {
        if (!cancelled) setPlace({ tz: browserTz });
      }
    })();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    const tick = () => {
      try {
        setTime(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit", timeZone: place.tz || undefined }).format(new Date()));
      } catch {
        setTime(new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(new Date()));
      }
    };
    tick();
    const id = setInterval(tick, 30_000);
    return () => clearInterval(id);
  }, [place.tz]);

  if (!time) return null; // nothing resolved yet — stay invisible, never block paint

  return (
    <div
      className={`hidden items-center gap-2 rounded-full border border-[color:var(--surface-border)] bg-white/5 px-3 py-1.5 font-mono text-[11px] text-fog backdrop-blur-sm sm:flex ${className}`}
      title={`${[weather?.label, place.city].filter(Boolean).join(" · ") || "Local time"} · approximate location from IP`}
    >
      {weather && <span className="text-[13px] leading-none" aria-hidden>{weather.emoji}</span>}
      {weather && <span className="text-cloud">{weather.temp}{weather.unit}</span>}
      {weather && <span className="text-fog/40">·</span>}
      <span className="text-cloud">{time}</span>
      {place.city && <><span className="text-fog/40">·</span><span className="max-w-[12ch] truncate">{place.city}</span></>}
    </div>
  );
}
