"""Auditable Codex CLI adapter used for real, local engineering work."""
from __future__ import annotations

import json
import logging
import os
import subprocess
import tempfile
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Callable

logger = logging.getLogger("umbra.codex")

# Whitelists for user-selectable speed knobs. Only these values are ever passed
# into `codex exec`'s `-m` / `-c` flags, so an arbitrary client can never inject
# config. gpt-5.6-luna = fastest, terra = balanced, sol = deepest.
_CODEX_MODELS = {"gpt-5.6-luna", "gpt-5.6-terra", "gpt-5.6-sol"}
_CODEX_EFFORTS = {"minimal", "low", "medium", "high"}


@dataclass
class CodexOperation:
    prompt: str
    summary: str
    diff: str
    tests_passed: bool | None
    files: list[str]
    provider: str
    created_at: str
    command: list[str] | None = None
    stdout: str = ""
    error: str | None = None

    def as_dict(self) -> dict[str, object]:
        return asdict(self)


Runner = Callable[..., subprocess.CompletedProcess[str]]


class CodexClient:
    """Delegate code work to ``codex exec`` and preserve an inspectable replay.

    The CLI is opt-in through ``UMBRA_ENABLE_CODEX_CLI=true``. It is always run
    against a disposable local checkout supplied by the caller; Codex receives a
    hard no-push/no-merge instruction and Umbra never supplies GitHub write
    credentials to the child process.
    """

    def __init__(
        self,
        replay_dir: Path | None = None,
        runner: Runner = subprocess.run,
        model: str | None = None,
        reasoning_effort: str | None = None,
    ) -> None:
        self.replay_dir = replay_dir
        self.runner = runner
        # A caller value wins over the env default; both are validated so an
        # unknown model/effort simply falls back to Codex's own default (no flag).
        self.model = self.resolve_model(model if model is not None else os.getenv("UMBRA_CODEX_MODEL"))
        self.reasoning_effort = self.resolve_effort(
            reasoning_effort if reasoning_effort is not None else os.getenv("UMBRA_CODEX_REASONING_EFFORT")
        )

    @staticmethod
    def enabled() -> bool:
        return os.getenv("UMBRA_ENABLE_CODEX_CLI", "false").lower() == "true"

    @staticmethod
    def cli_version(runner: Runner = subprocess.run) -> str | None:
        """Best-effort ``codex --version`` string, or None if unobservable.

        Honesty rule: we return exactly what the CLI reports (trimmed), and None
        when the binary is absent or the probe fails — we never fabricate a version.
        """
        try:
            r = runner(["codex", "--version"], text=True, capture_output=True, timeout=15, check=False)
        except (OSError, subprocess.SubprocessError):
            return None
        if r is None:
            return None
        out = ((getattr(r, "stdout", "") or "") + (getattr(r, "stderr", "") or "")).strip()
        return out.splitlines()[0].strip() if out else None

    def model_identity(self, executor: str) -> dict[str, Any]:
        """Truthful model provenance for the signed receipt.

        - ``executor``          — who produced the change (``codex-cli`` / ``deterministic``).
        - ``codex_cli_version`` — observed ``codex --version`` or ``unavailable``.
        - ``model_configured``  — the model Umbra explicitly requested via ``-m`` (validated
          allowlist), or ``codex-default`` when we passed no ``-m`` flag (we did NOT pin a
          model and Codex used its own default — we do not guess which).
        - ``model_resolved``    — the model a provider/CLI **explicitly reported** as the one
          that ran. Passing ``-m`` proves the model was *requested*, NOT that the provider
          confirmed it ran, so this stays ``unavailable`` unless a provider response or CLI
          output attests the resolved model. We never promote a configured value to resolved.
        - ``model_evidence``    — how ``model_configured`` is known: ``cli-argument`` when we
          set it via ``-m`` (a request, not attestation), ``codex-default`` when unset, or
          ``no-model`` for the deterministic path. A ``provider-attested`` value would only
          appear if a provider actually returned the resolved model (not the CLI path today).

        For the deterministic executor no model runs, so every model field is stated as
        such — we never imply a model participated when one did not.
        """
        if executor != "codex-cli":
            return {
                "executor": executor,
                "codex_cli_version": None,
                "model_configured": None,
                "model_resolved": None,
                "model_evidence": "no-model",
                "note": "Deterministic policy evaluation — no coding model was invoked.",
            }
        pinned = self.model  # validated against _CODEX_MODELS in __init__, or None
        return {
            "executor": "codex-cli",
            "codex_cli_version": self.cli_version(self.runner) or "unavailable",
            "model_configured": pinned or "codex-default",
            # A configured (-m) model is REQUESTED, not attested-as-run. The CLI does
            # not report the model it resolved, so we honestly leave this unavailable
            # until a provider/CLI explicitly attests it. Never inferred.
            "model_resolved": "unavailable",
            "model_evidence": "cli-argument" if pinned else "codex-default",
            "reasoning_effort": self.reasoning_effort or "codex-default",
        }

    @staticmethod
    def resolve_model(value: str | None) -> str | None:
        value = (value or "").strip()
        return value if value in _CODEX_MODELS else None

    @staticmethod
    def resolve_effort(value: str | None) -> str | None:
        value = (value or "").strip().lower()
        return value if value in _CODEX_EFFORTS else None

    def propose(self, prompt: str, files: list[str] | None = None, repo_path: Path | None = None, read_only: bool = False) -> CodexOperation:
        if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
            return self._record(self._demo_operation(prompt, files or []))
        if not self.enabled():
            return self._record(self._disabled_operation(prompt, files or []))
        if repo_path is None or not repo_path.is_dir():
            raise RuntimeError("A checked-out repository is required when UMBRA_ENABLE_CODEX_CLI=true")
        return self._record(self._run_cli(prompt, repo_path, read_only=read_only))

    def analyze(self, prompt: str) -> CodexOperation:
        """Read-only Codex reasoning with no repository required.

        The Codex CLI itself runs a GPT-5.6 model, so this is Umbra's honest
        reasoning fallback when the Responses API is unavailable. The result is
        always labelled ``codex-cli`` in the provider ledger; it is never
        presented as the Responses API, and the read-only sandbox guarantees no
        file, network, or shell side effects.
        """
        if os.getenv("UMBRA_DEMO_MODE", "false").lower() == "true":
            return self._record(self._demo_operation(prompt, []))
        if not self.enabled():
            return self._record(self._disabled_operation(prompt, []))
        with tempfile.TemporaryDirectory(prefix="umbra-reason-") as work_dir:
            return self._record(self._run_cli(prompt, Path(work_dir), read_only=True, cli_prompt=self._reason_prompt(prompt)))

    def cached_fallback(self, prompt: str, files: list[str] | None = None, note: str = "") -> CodexOperation:
        """Record an honest non-live result after an integration failure."""
        operation = CodexOperation(
            prompt=prompt,
            summary=note or "Live Codex did not run; cached demo material is being shown.",
            diff="", tests_passed=None, files=files or [], provider="cache-fallback",
            created_at=datetime.now(UTC).isoformat(),
        )
        return self._record(operation)

    @staticmethod
    def _resolve_sandbox(read_only: bool) -> str:
        """Sandbox mode for ``codex exec``.

        Codex's own Linux sandbox (Landlock/seccomp + namespaces) may be unavailable
        under some container runtimes for a given profile — e.g. the verified
        ``workspace-write`` profile cannot establish its network-namespace loopback
        on this runtime (gVisor), so ``codex exec`` exits non-zero before doing work.
        A preflight probe (``preflight_sandbox``) verifies the profile per-runtime
        rather than assuming. ``UMBRA_CODEX_SANDBOX`` lets a deploy select an
        unsandboxed profile (``danger-full-access``/``bypass``) — but ONLY when the
        second flag ``UMBRA_ALLOW_UNSAFE_CODEX=true`` is also set; otherwise the
        override is ignored (downgraded to a safe default) and logged, so an
        accidental/leaked value can never silently run the agent unsandboxed.
        """
        override = os.getenv("UMBRA_CODEX_SANDBOX", "").strip().lower()
        unsafe = {"danger-full-access", "bypass"}
        if override in unsafe:
            # The unsafe modes disable Codex's own sandbox — only honor them behind an
            # explicit second flag so an accidental/leaked UMBRA_CODEX_SANDBOX can't
            # silently run the agent unsandboxed. Log loudly on every invocation.
            if os.getenv("UMBRA_ALLOW_UNSAFE_CODEX", "").strip().lower() not in {"1", "true", "yes"}:
                logging.getLogger("umbra.codex").warning(
                    "UMBRA_CODEX_SANDBOX=%s ignored: set UMBRA_ALLOW_UNSAFE_CODEX=true to enable "
                    "the unsandboxed mode (falling back to a safe default).", override,
                )
                return "read-only" if read_only else "workspace-write"
            logging.getLogger("umbra.codex").warning(
                "Codex running with sandbox=%s (UNSANDBOXED) — the container is the only "
                "isolation boundary. Enabled via UMBRA_ALLOW_UNSAFE_CODEX.", override,
            )
            return override
        if override in {"read-only", "workspace-write"}:
            return override
        return "read-only" if read_only else "workspace-write"

    @staticmethod
    def effective_sandbox(read_only: bool = False) -> dict[str, Any]:
        """Report the CONFIGURED vs EFFECTIVE sandbox mode and any downgrade reason,
        so founder diagnostics never imply an unsafe mode is active when it isn't.

        Example: with ``UMBRA_CODEX_SANDBOX=danger-full-access`` but no
        ``UMBRA_ALLOW_UNSAFE_CODEX=true``, ``configured`` is ``danger-full-access``
        while ``effective`` is ``workspace-write`` and ``downgrade_reason`` explains
        that the unsafe override was ignored.
        """
        configured = os.getenv("UMBRA_CODEX_SANDBOX", "").strip().lower() or "(unset)"
        unsafe_allowed = os.getenv("UMBRA_ALLOW_UNSAFE_CODEX", "").strip().lower() in {"1", "true", "yes"}
        effective = CodexClient._resolve_sandbox(read_only)
        downgrade_reason = None
        if configured in {"danger-full-access", "bypass"} and not unsafe_allowed:
            downgrade_reason = (
                f"Configured sandbox '{configured}' was IGNORED because "
                "UMBRA_ALLOW_UNSAFE_CODEX is not set; using the safe default "
                f"'{effective}'. (We intentionally do not enable an unsandboxed mode "
                "just to make a run succeed.)"
            )
        return {
            "configured": configured,
            "effective": effective,
            "unsafe_override_allowed": unsafe_allowed,
            "downgrade_reason": downgrade_reason,
        }

    # --- Sandbox capability preflight -------------------------------------------
    # Signatures that mean "the sandbox layer itself could not initialize" (a
    # capability/config problem in this runtime), as opposed to a model/repo result.
    _SANDBOX_FAIL_SIGNATURES = (
        "bwrap:",
        "rtm_newaddr",
        "failed to create",
        "no child process",
        "operation not permitted",
        "landlock",
        "seccomp",
        "namespace",
        "unshare",
        "clone3",
        "permission denied (os error 13)",
    )

    def preflight_sandbox(self) -> dict[str, Any]:
        """Probe whether Codex's sandbox can execute a HARMLESS command in this
        runtime, using the EXACT sandbox mode a real run will use.

        Does not clone a repo, call the model on real work, spend a Codex allowance,
        or run any user/repo command — it runs `true` inside an empty throwaway dir.
        Returns a structured status the caller uses to decide whether to dispatch
        agents at all.

        sandbox_status: 'verified' | 'host_restricted' | 'unavailable'
        """
        mode = self._resolve_sandbox(read_only=False)
        eff = self.effective_sandbox(read_only=False)  # configured vs effective + downgrade reason
        # Unsandboxed override (founder-approved) needs no probe — the container is
        # the boundary and there is no bwrap/netns layer to fail.
        if mode in {"danger-full-access", "bypass"}:
            return {"sandbox_status": "verified", "sandbox_runtime": "container", "sandbox_mode": mode,
                    "sandbox_error_code": None, "diagnostic": "Codex sandbox bypassed (container is the isolation boundary).",
                    "enforcement": "container", "effective_config": eff}
        with tempfile.TemporaryDirectory(prefix="umbra-codex-probe-") as tmp:
            sandbox_args = ["--sandbox", mode]
            # A trivial, side-effect-free instruction; --skip-git-repo-check so the
            # throwaway dir needn't be a git repo. We only care whether the sandbox
            # LAYER boots (exit code + stderr), not what the model says.
            command = [
                "codex", "exec", "--ephemeral", "--color", "never",
                *sandbox_args, "--skip-git-repo-check", "-C", tmp,
                "run the shell command `true` and stop. change nothing.",
            ]
            try:
                r = self.runner(command, text=True, capture_output=True, timeout=120, check=False)
            except (OSError, subprocess.SubprocessError) as exc:
                return {"sandbox_status": "unavailable", "sandbox_runtime": "unknown", "sandbox_mode": mode,
                        "sandbox_error_code": type(exc).__name__, "diagnostic": str(exc)[:300],
                        "enforcement": "none", "effective_config": eff}
            rc = getattr(r, "returncode", 1)
            stderr = (getattr(r, "stderr", "") or "")
            low = stderr.lower()
            if rc == 0:
                return {"sandbox_status": "verified", "sandbox_runtime": "bwrap", "sandbox_mode": mode,
                        "sandbox_error_code": None, "diagnostic": "Sandbox initialized and executed a probe command.",
                        "enforcement": "sandboxed", "effective_config": eff}
            # Non-zero: is it a sandbox-capability failure (our target) or something else?
            sandbox_capability_failure = any(sig in low for sig in self._SANDBOX_FAIL_SIGNATURES)
            code = "bwrap_netns" if ("bwrap" in low or "rtm_newaddr" in low or "no child process" in low) else "sandbox_init"
            return {
                "sandbox_status": "unavailable",
                "sandbox_runtime": "bwrap" if "bwrap" in low else "unknown",
                "sandbox_mode": mode,
                "sandbox_error_code": code if sandbox_capability_failure else f"exit_{rc}",
                "diagnostic": self._sanitize_paths(stderr[-600:], Path(tmp)).strip() or f"codex exec exited {rc} with no stderr.",
                "enforcement": "none",
                "effective_config": eff,
            }


    @staticmethod
    def _short_reason(stderr: str) -> str:
        """The most actionable single line from Codex stderr (for an honest summary).

        Known failure signatures are mapped to a clean, human message so the UI
        never surfaces raw Cloudflare/transport noise (``cf-ray``, ``wss://…``).
        A 401 against ``api.openai.com`` means Codex could not use the mounted
        ChatGPT login — almost always because that account has no Codex access
        (a free plan) or the login expired — and no ``OPENAI_API_KEY`` is set.
        Unknown failures fall through to the raw last line so real errors (e.g. a
        Landlock/sandbox message) are still surfaced verbatim, not swallowed.
        """
        low = (stderr or "").lower()
        if any(sig in low for sig in ("401 unauthorized", "missing bearer", "invalid_api_key", "unauthorized")):
            return ("Codex could not authenticate with OpenAI (401). The connected ChatGPT "
                    "account needs Codex access — sign in with a paid ChatGPT plan via `codex "
                    "login`, or set an OPENAI_API_KEY.")
        if any(sig in low for sig in ("429", "rate limit", "quota", "insufficient_quota")):
            return "Codex hit an OpenAI rate limit or quota. Try again shortly."
        lines = [line.strip() for line in (stderr or "").splitlines() if line.strip()]
        return (lines[-1][:300] if lines else "no output on stderr")

    def _run_cli(self, prompt: str, repo_path: Path, read_only: bool = False, cli_prompt: str | None = None) -> CodexOperation:
        with tempfile.TemporaryDirectory(prefix="umbra-codex-") as temp_dir:
            final_message = Path(temp_dir) / "final-message.txt"
            # ``codex exec`` is non-interactive (approval policy is already
            # ``never``); the removed ``--ask-for-approval`` flag is rejected by
            # current CLI versions. ``--skip-git-repo-check`` lets read-only
            # reasoning run in a throwaway directory that is not a Git repo.
            sandbox = self._resolve_sandbox(read_only)
            sandbox_args = (
                ["--dangerously-bypass-approvals-and-sandbox"]
                if sandbox == "bypass"
                else ["--sandbox", sandbox]
            )
            # Speed knobs: a lighter model and/or lower reasoning effort make the
            # scan dramatically faster. Both are already whitelisted (see __init__),
            # so this never forwards unvalidated input into the CLI config.
            model_args = ["-m", self.model] if self.model else []
            effort_args = (
                ["-c", f'model_reasoning_effort="{self.reasoning_effort}"'] if self.reasoning_effort else []
            )
            command = [
                "codex", "exec", "--ephemeral", "--color", "never",
                *sandbox_args,
                *model_args,
                *effort_args,
                "--skip-git-repo-check",
                "--output-last-message", str(final_message), "-C", str(repo_path),
                cli_prompt or self._safe_prompt(prompt),
            ]
            completed = self.runner(command, text=True, capture_output=True, timeout=900, check=False)
            diff = self._git(repo_path, ["diff", "--binary"])
            changed = [line for line in self._git(repo_path, ["diff", "--name-only"]).splitlines() if line]
            final = final_message.read_text(errors="replace") if final_message.exists() else completed.stdout
            summary = final.strip() or completed.stdout.strip()
            if not summary:
                if completed.returncode == 0:
                    summary = "Codex ran and produced no changes — nothing needed here." if not diff else "Codex completed; see the diff below."
                else:
                    # Surface the real reason instead of an opaque message, and log the
                    # full stderr so Cloud Run captures it (it is otherwise dropped).
                    reason = self._short_reason(completed.stderr)
                    summary = f"Codex CLI failed (exit {completed.returncode}, sandbox={sandbox}): {reason}"
            if completed.returncode != 0:
                logger.warning("codex exec failed (rc=%s, sandbox=%s): %s", completed.returncode, sandbox, (completed.stderr or "")[-2000:])
            # Codex embeds the absolute checkout path in its prose; strip it so the
            # user-facing summary/stdout read repo-relative (see _sanitize_paths).
            operation = CodexOperation(
                prompt=prompt,
                summary=self._sanitize_paths(summary, repo_path),
                diff=diff,
                tests_passed=completed.returncode == 0,
                files=changed,
                # Provider describes PRODUCED output, not an attempted launch: a
                # non-zero exit (sandbox init failure, auth, etc.) means Codex did
                # not produce engineering work, so it is 'unavailable', never green.
                provider="codex-cli" if completed.returncode == 0 else "unavailable",
                created_at=datetime.now(UTC).isoformat(),
                command=command[:-1] + ["<agent prompt redacted from command replay>"],
                stdout=self._sanitize_paths(completed.stdout[-12000:], repo_path),
                error=self._sanitize_paths(completed.stderr[-4000:], repo_path) or None,
            )
        return operation

    @staticmethod
    def _git(repo_path: Path, args: list[str]) -> str:
        result = subprocess.run(["git", *args], cwd=repo_path, text=True, capture_output=True, check=False)
        return result.stdout

    @staticmethod
    def _sanitize_paths(text: str, repo_path: Path) -> str:
        """Rewrite the disposable checkout's absolute path out of Codex's prose.

        Codex runs with ``-C <repo_path>`` and freely embeds that absolute
        temp-dir path in its explanation (e.g. markdown links to changed files).
        Left raw it leaks the server's filesystem layout into the user-facing
        Morning Report (``/private/var/folders/…`` locally, ``/tmp/…`` in the
        Cloud Run container). Stripping the prefix makes those paths read
        repo-relative. The git diff already uses repo-relative ``a/…``/``b/…``
        prefixes, so only free text (summary / stdout / stderr) needs this.
        """
        if not text:
            return text
        # macOS symlinks /var/folders → /private/var/folders, and mkdtemp() and
        # Codex may report opposite forms, so cover both spellings of each base.
        prefixes: set[str] = set()
        for base in (str(repo_path), str(repo_path.resolve())):
            prefixes.add(base)
            if base.startswith("/private/"):
                prefixes.add(base[len("/private"):])
            elif base.startswith("/var/"):
                prefixes.add("/private" + base)
        for prefix in sorted(prefixes, key=len, reverse=True):
            text = text.replace(prefix + os.sep, "").replace(prefix, "")
        return text

    @staticmethod
    def _safe_prompt(mission: str) -> str:
        return f"""You are Codex working for Umbra in a disposable local checkout.
Mission: {mission}

Hard rules: never push, commit, create a PR, merge, approve, deploy, force-push,
or expose a secret. You may inspect and edit only this checkout. Make the minimum
safe change, run relevant tests, and finish with a concise explanation of changed
files, exact tests run, and anything that prevented verification."""

    @staticmethod
    def _reason_prompt(mission: str) -> str:
        return f"""You are Codex acting as Umbra's reasoning analyst in a read-only, empty workspace.
Task:
{mission}

Rules: There is no repository here. Do not attempt to edit, create, run, push, or
inspect any files. Reason only from the text supplied in the task above. Never
invent files, line numbers, commit SHAs, CVEs, or behavior. If the supplied
context is insufficient, say so plainly. Respond with a concise, well-structured
analysis and nothing else."""

    @staticmethod
    def _demo_operation(prompt: str, files: list[str]) -> CodexOperation:
        return CodexOperation(prompt, "Demo Codex result replayed from cache; no CLI invocation was made.", "", None, files, "demo-cache", datetime.now(UTC).isoformat())

    @staticmethod
    def _disabled_operation(prompt: str, files: list[str]) -> CodexOperation:
        return CodexOperation(prompt, "Live Codex is disabled. Set UMBRA_ENABLE_CODEX_CLI=true to run a real disposable-checkout task.", "", None, files, "codex-cli-disabled", datetime.now(UTC).isoformat())

    def _record(self, operation: CodexOperation) -> CodexOperation:
        if self.replay_dir:
            self.replay_dir.mkdir(parents=True, exist_ok=True)
            name = f"codex-{datetime.now(UTC).strftime('%Y%m%dT%H%M%S%f')}.json"
            (self.replay_dir / name).write_text(json.dumps(operation.as_dict(), indent=2))
        return operation
