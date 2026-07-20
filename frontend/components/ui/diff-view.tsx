"use client";

/* -----------------------------------------------------------------------------
   DiffView — render a real unified diff (multi-file) as a reviewable surface:
   per-file grouping, hunk headers, old/new line-number gutters, +/− colouring.

   HONESTY: this only ever renders the exact patch text it is given (an agent's
   real replay.codex_diff). It parses — it never fabricates lines, and it never
   claims the change was merged. No external diff library; the parser mirrors the
   landing pipeline's parseDiffHunk so both surfaces read a diff identically.

   PERF/A11Y/THEME: static DOM (no animation, so reduced-motion is a no-op),
   colour-only accents over theme tokens (works in dark + vanilla light), and a
   hard line cap so a huge patch can't blow up the DOM (the remainder is noted,
   never silently dropped).
----------------------------------------------------------------------------- */

import { useMemo } from "react";

export type DiffLine = { kind: "ctx" | "add" | "del" | "hunk"; text: string; oldNo?: number; newNo?: number };
// `note` marks a change with no textual hunk (binary / rename / mode) so it is
// still surfaced honestly instead of vanishing as "no change".
export type DiffFile = { path: string; additions: number; deletions: number; lines: DiffLine[]; note?: string };

/** Parse a unified diff into typed per-file line lists, tracking real line
 *  numbers from each `@@ -a,b +c,d @@` header. `maxLines` caps the total number
 *  of content rows across all files; the overflow count is returned so the UI
 *  can say how many lines were hidden rather than pretending the patch is small. */
export function parseUnifiedDiff(diff: string, opts?: { maxLines?: number }): { files: DiffFile[]; truncated: number } {
  const cap = opts?.maxLines ?? Number.POSITIVE_INFINITY;
  const files: DiffFile[] = [];
  let cur: DiffFile | null = null;
  let inHunk = false;
  let oldNo = 0;
  let newNo = 0;
  let total = 0;
  let truncated = 0;

  for (const raw of (diff ?? "").split("\n")) {
    if (raw.startsWith("diff --git")) {
      const m = raw.match(/^diff --git a\/.+ b\/(.+)$/);
      cur = { path: m ? m[1] : "file", additions: 0, deletions: 0, lines: [] };
      files.push(cur);
      inHunk = false;
      continue;
    }
    // A diff produced by `git diff`/`git apply` may omit the `diff --git` line and
    // start straight at `--- a/… / +++ b/…`; open a file on the first +++ path.
    if (!cur) {
      const p = raw.match(/^\+\+\+ b\/(.+)$/);
      if (p) { cur = { path: p[1], additions: 0, deletions: 0, lines: [] }; files.push(cur); inHunk = false; }
      continue;
    }
    if (raw.startsWith("@@")) {
      const m = raw.match(/@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/);
      oldNo = m ? parseInt(m[1], 10) : 0;
      newNo = m ? parseInt(m[2], 10) : 0;
      cur.lines.push({ kind: "hunk", text: raw });
      inHunk = true;
      continue;
    }
    if (!inHunk) {
      // Pre-hunk headers (---, +++, index, new/deleted/rename/binary/mode). Keep the
      // real path if `diff --git` was absent or gave a placeholder, and record a note
      // for a change that carries no textual hunk so it's surfaced, not dropped.
      const p = raw.match(/^\+\+\+ b\/(.+)$/);
      if (p && (cur.path === "file")) cur.path = p[1];
      if (raw === "GIT binary patch" || raw.startsWith("Binary files ")) cur.note = "Binary file changed — view on GitHub";
      else if (raw.startsWith("rename to ")) cur.note = `Renamed → ${raw.slice("rename to ".length)}`;
      else if (raw.startsWith("rename from ") && !cur.note) cur.note = "Renamed";
      else if (raw.startsWith("deleted file mode")) cur.note = "File deleted";
      else if (raw.startsWith("new file mode") && !cur.note) cur.note = "New file";
      else if (raw.startsWith("old mode ") && !cur.note) cur.note = "File mode changed";
      continue;
    }
    if (raw.startsWith("\\")) continue; // "\ No newline at end of file"
    if (raw === "") continue; // trailing-newline split artifact (real diff lines carry a +/-/space prefix)
    // Count every +/- line for an HONEST per-file diffstat, even when the render is
    // capped — otherwise the +N/−M badge would understate a truncated file.
    if (raw.startsWith("+")) {
      cur.additions++;
      if (total >= cap) { truncated++; continue; }
      cur.lines.push({ kind: "add", text: raw.slice(1), newNo }); newNo++; total++;
    } else if (raw.startsWith("-")) {
      cur.deletions++;
      if (total >= cap) { truncated++; continue; }
      cur.lines.push({ kind: "del", text: raw.slice(1), oldNo }); oldNo++; total++;
    } else {
      if (total >= cap) { truncated++; continue; }
      const t = raw.startsWith(" ") ? raw.slice(1) : raw;
      cur.lines.push({ kind: "ctx", text: t, oldNo, newNo }); oldNo++; newNo++; total++;
    }
  }

  // Trim trailing blank context rows (unified diffs end with a newline).
  for (const f of files) {
    while (f.lines.length && f.lines[f.lines.length - 1].kind === "ctx" && f.lines[f.lines.length - 1].text.trim() === "") f.lines.pop();
  }
  // Keep any file that actually changed: has textual content, a note (binary/rename/
  // mode), or non-zero counts (its lines fell past the render cap). Drop only pure
  // header/hunk noise. A file changed but rendered without content still appears.
  const changed = files.filter((f) => f.lines.some((l) => l.kind !== "hunk") || f.note || f.additions || f.deletions);
  return { files: changed, truncated };
}

function Row({ line }: { line: DiffLine }) {
  if (line.kind === "hunk") {
    return (
      <tr>
        <td colSpan={3} className="select-none bg-[color:var(--surface-2)] px-3 py-1 font-mono text-[10px] text-fog/80">{line.text}</td>
      </tr>
    );
  }
  const tone =
    line.kind === "add" ? "bg-teal/10 text-cloud" : line.kind === "del" ? "bg-rose-400/10 text-cloud" : "text-fog";
  const sign = line.kind === "add" ? "+" : line.kind === "del" ? "−" : " ";
  const signTone = line.kind === "add" ? "text-teal" : line.kind === "del" ? "text-[color:var(--sev-critical)]" : "text-fog/40";
  return (
    <tr className={tone}>
      <td className="select-none border-r border-[color:var(--surface-border)] px-2 text-right align-top text-[10px] tabular-nums text-fog/50">{line.oldNo ?? ""}</td>
      <td className="select-none border-r border-[color:var(--surface-border)] px-2 text-right align-top text-[10px] tabular-nums text-fog/50">{line.newNo ?? ""}</td>
      <td className="whitespace-pre-wrap break-all px-2 align-top">
        <span className={`select-none ${signTone}`}>{sign} </span>{line.text}
      </td>
    </tr>
  );
}

export function DiffView({ diff, className, maxLines = 500 }: { diff: string; className?: string; maxLines?: number }) {
  const { files, truncated } = useMemo(() => parseUnifiedDiff(diff, { maxLines }), [diff, maxLines]);

  if (!diff?.trim() || files.length === 0) {
    return <p className={`text-[13px] text-fog ${className ?? ""}`}>No changes to display.</p>;
  }

  return (
    <div className={`flex flex-col gap-3 ${className ?? ""}`}>
      {files.map((f, i) => {
        const hasContent = f.lines.some((l) => l.kind !== "hunk");
        return (
          <div key={`${f.path}:${i}`} className="overflow-hidden rounded-lg border border-[color:var(--surface-border)] bg-[color:var(--input-bg)]">
            <div className="flex items-center justify-between gap-3 border-b border-[color:var(--surface-border)] px-3 py-2">
              <span className="truncate font-mono text-[11px] text-cloud" title={f.path}>{f.path}</span>
              {(f.additions > 0 || f.deletions > 0) && (
                <span className="shrink-0 font-mono text-[10px]"><span className="text-teal">+{f.additions}</span> <span className="text-[color:var(--sev-critical)]">−{f.deletions}</span></span>
              )}
            </div>
            {hasContent ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse font-mono text-[12px] leading-[1.55]">
                  <tbody>
                    {f.lines.map((l, j) => <Row key={j} line={l} />)}
                  </tbody>
                </table>
              </div>
            ) : (
              // A real change with no rendered lines (binary/rename/mode, or its lines
              // fell past the size cap) — say so honestly rather than showing nothing.
              <p className="px-3 py-2 font-mono text-[11px] text-fog">{f.note ?? "Changed — full patch hidden by size cap; view on GitHub."}</p>
            )}
          </div>
        );
      })}
      {truncated > 0 && (
        <p className="font-mono text-[11px] text-fog">… {truncated} more line(s) hidden — open the PR on GitHub for the full patch.</p>
      )}
    </div>
  );
}
