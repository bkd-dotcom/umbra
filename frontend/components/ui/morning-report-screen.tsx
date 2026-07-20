/* The morning report as it appears on the MacBook screen in the landing showcase.
   Designed to fill a 4:3 canvas (rendered to a crisp PNG at build-authoring time
   and shown as the laptop's screen `src`, so it never distorts under the lid's
   scale animation). Marketing/showcase content — illustrative sample numbers,
   same language + honesty framing as the real product report. Theme-aware via the
   site's CSS tokens. */
export function MorningReportScreen() {
  const dispatch = [
    { k: "W", n: "Watchman", c: "#5eead4", line: "CVE-2024-29041 · patch to 4.19.2 prepared" },
    { k: "D", n: "Detective", c: "#fbbf24", line: "traced to commit a9c31f" },
    { k: "R", n: "Reviewer", c: "#a78bfa", line: "PR #128 · blast-radius low" },
    { k: "J", n: "Janitor", c: "#22d3ee", line: "4 dead exports swept · PR drafted" },
    { k: "A", n: "Ask Umbra", c: "#f472b6", line: "3 answers grounded · router.js:22" },
  ];
  return (
    <div
      className="absolute inset-0 flex flex-col overflow-hidden bg-[color:var(--color-ink)] px-12 py-11 text-left"
      style={{ backgroundImage: "radial-gradient(120% 80% at 50% -18%, rgba(251,191,36,0.10), transparent 55%), radial-gradient(90% 70% at 100% 120%, rgba(94,234,212,0.08), transparent 60%)" }}
    >
      {/* header */}
      <div className="flex items-center justify-between font-mono text-[15px] uppercase tracking-[0.24em] text-fog">
        <span className="flex items-center gap-3">
          <span className="h-2 w-2 rounded-full" style={{ background: "#5eead4", boxShadow: "0 0 12px #5eead4" }} />
          Good morning
        </span>
        <span className="tabular-nums text-fog/70">06:00 · night shift #001</span>
      </div>
      <div className="mt-5 h-px w-full" style={{ background: "linear-gradient(90deg, rgba(251,191,36,0.55), rgba(251,191,36,0.08) 45%, transparent 70%)" }} />

      {/* score */}
      <div className="mt-8 flex items-end justify-between gap-8">
        <div className="flex items-end gap-3">
          <span className="font-serif text-[112px] leading-[0.72] tracking-[-0.04em] text-cloud">78</span>
          <span className="mb-2 font-mono text-[17px] text-fog/60">/ 100</span>
        </div>
        <div className="max-w-[30ch] text-right">
          <div className="font-serif text-[30px] leading-tight text-amber">Needs attention</div>
          <p className="mt-2 font-mono text-[13.5px] leading-snug text-fog">
            Two fixable risks — patches drafted, waiting for your review. Nothing merged.
          </p>
        </div>
      </div>

      {/* dispatch */}
      <div className="mt-9 flex items-center gap-3 font-mono text-[13px] uppercase tracking-[0.22em] text-fog/70">
        <span className="h-px w-8" style={{ background: "var(--surface-border)" }} />
        The night&rsquo;s work
      </div>
      <div className="mt-2 flex flex-1 flex-col divide-y divide-[color:var(--surface-border)]">
        {dispatch.map((d) => (
          <div key={d.k} className="flex items-center gap-4 py-[13px]">
            <span
              className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border font-mono text-[15px] font-semibold"
              style={{ color: d.c, borderColor: `${d.c}55`, background: `${d.c}16` }}
            >
              {d.k}
            </span>
            <span className="w-[150px] shrink-0 font-mono text-[14px] font-semibold uppercase tracking-[0.12em] text-cloud">{d.n}</span>
            <span className="flex-1 truncate font-mono text-[14px] text-fog">{d.line}</span>
            <span className="shrink-0 font-mono text-[11px] uppercase tracking-[0.16em] text-fog/45">filed</span>
          </div>
        ))}
      </div>

      {/* footer */}
      <div className="mt-3 border-t border-[color:var(--surface-border)] pt-4 font-mono text-[12px] leading-relaxed text-fog/70">
        Filed 06:00 · grounded in OSV + git history · never fabricated · reasoned by OpenAI · never merged without you
      </div>
    </div>
  );
}
