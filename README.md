# 🌑 Umbra — The AI engineer that works the night shift

Umbra is an autonomous AI engineering team for your GitHub repo. Five agents run
without prompting — hunting CVEs, reviewing PRs, tracing incidents, and killing
tech debt — then draft pull requests you review in the morning. Codex does the
engineering; GPT-5.6 does the reasoning; you approve the merge.

## 🧑‍⚖️ Test it 3 ways (no rebuild required)

**1 — Custom GPT (in ChatGPT):** open **Umbra Engineer** → `Scan https://github.com/expressjs/express`
**2 — Live dashboard (0 setup):** https://umbra.engineer
**3 — Demo repo (real PRs):** https://github.com/<YOUR_GITHUB_USERNAME>/umbra-demo-target/pulls

## 🤖 How Codex + GPT-5.6 are used
- **Codex** (Codex Cloud / SDK / GitHub Action / native code review) explores the
  repo, edits code, runs tests in a sandbox, and drafts the pull requests.
- **GPT-5.6 Sol** does the deep reasoning — root-cause chains, blast-radius, and
  threat modeling; **Terra** handles everyday reasoning and Ask Umbra; **Luna**
  handles summaries and docstrings.
- Built with Codex. Codex `/feedback` session ID: `<SESSION_ID>`

## 💻 Supported platforms
macOS · Linux · Windows (Python 3.11+). Any public GitHub repository.

## 🔧 Run from source
```bash
git clone https://github.com/<YOUR_GITHUB_USERNAME>/umbra
cd umbra
cp backend/.env.example backend/.env      # add OPENAI_API_KEY (+ GITHUB_TOKEN)
pip install -e .
uvicorn backend.main:app --reload          # API at http://localhost:8000
cd frontend && npm install && npm run dev  # dashboard at http://localhost:3000
```
Set `UMBRA_DEMO_MODE=true` to run the fully cached demo with no API keys.
