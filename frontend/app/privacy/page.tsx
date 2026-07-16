import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Umbra — Privacy",
  description: "How Umbra handles data across the web app and the ChatGPT plugin / GPT Action.",
};

// Static privacy page. Required as the plugin/GPT-Action `legal_info_url`, and a
// straight, honest statement of how Umbra handles data. No client JS needed.
export default function Privacy() {
  return (
    <main className="mx-auto min-h-screen w-full max-w-[760px] px-6 py-20 md:px-10">
      <a href="/" className="font-mono text-[12px] text-cyan hover:underline">← umbra.engineer</a>
      <h1 className="mt-6 font-serif text-[clamp(30px,4vw,44px)] leading-tight">Privacy</h1>
      <p className="mt-3 text-[13px] text-fog">Last updated: July 2026</p>

      <div className="mt-8 flex flex-col gap-6 text-[14px] leading-relaxed text-cloud/90">
        <section>
          <h2 className="font-serif text-xl text-cloud">What Umbra does</h2>
          <p className="mt-2 text-fog">
            Umbra analyzes GitHub repositories to surface dependency CVEs, trace incidents to a
            root-cause commit, and answer grounded questions about a codebase. It is available as a
            web app at umbra.engineer and as a ChatGPT plugin / GPT Action.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-cloud">Repository data</h2>
          <p className="mt-2 text-fog">
            When you scan a repository, Umbra clones it into a <b className="text-cloud">disposable
            checkout</b> that is deleted as soon as the operation finishes. Umbra never pushes,
            commits, or merges; pull requests are only ever opened as new branches on your explicit
            request, and it never has or uses write access without you asking. Source code is not
            retained after a scan. The ChatGPT plugin / GPT Action calls only the anonymous,
            read-only scan / investigate / ask endpoints and requires no sign-in.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-cloud">Accounts &amp; credentials</h2>
          <p className="mt-2 text-fog">
            If you sign in (GitHub or Google) on the web app, Umbra stores your public profile plus,
            where you provide them, an access token or OpenAI API key — <b className="text-cloud">
            encrypted at rest</b> and used only to act on your own behalf. You can remove your
            OpenAI key and clear your saved scans at any time from the dashboard. Tokens are never
            passed to the Codex subprocess and never logged.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-cloud">Third parties</h2>
          <p className="mt-2 text-fog">
            Findings are grounded in real data from OSV.dev (advisories), GitHub (repository and PR
            metadata), and GPT-5.6 via OpenAI (Codex CLI and the Responses API) for reasoning.
            Requests to those services carry only what is needed to complete the operation.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-cloud">What Umbra never does</h2>
          <p className="mt-2 text-fog">
            No selling of data, no fabricated findings (every result is labelled with what produced
            it), and no autonomous writes to your repositories.
          </p>
        </section>

        <section>
          <h2 className="font-serif text-xl text-cloud">Contact</h2>
          <p className="mt-2 text-fog">
            Questions: <a href="mailto:binaydalai2024@gmail.com" className="text-cyan hover:underline">binaydalai2024@gmail.com</a>.
          </p>
        </section>
      </div>
    </main>
  );
}
