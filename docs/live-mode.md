# Live Watchman mode

Umbra is demo-safe by default. To run its real Watchman path against a public
repository, configure an API project that has access to the GPT-5.6 model family
and set the following server-side variables:

```bash
OPENAI_API_KEY=...
UMBRA_DEMO_MODE=false
UMBRA_ENABLE_LIVE_REPOS=true
UMBRA_ENABLE_CODEX_CLI=true
```

The live path clones the public repository into a disposable temporary directory,
removes its Git remote, reads dependency manifests, queries OSV, requests GPT-5.6
threat analysis, then invokes `codex exec` on that disposable copy. Its prompt
forbids pushing, committing, merging, PR creation, deployment, and secret output.
All providers, output, diff, test status, and failures are retained in the
Reasoning Replay record. A denied model entitlement is reported as
`reasoning: unavailable`; Umbra does not substitute a different model or fabricate
reasoning.
