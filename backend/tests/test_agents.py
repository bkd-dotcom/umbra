import asyncio

from backend.agents import AskUmbra, Detective, Janitor, Reviewer, Watchman


def test_agents_emit_structured_replays(monkeypatch):
    monkeypatch.setenv("UMBRA_DEMO_MODE", "true")

    async def run_all():
        return await asyncio.gather(
            Watchman().run("https://github.com/expressjs/express"),
            Reviewer().run("https://github.com/expressjs/express", "+++ auth.py"),
            Detective().run("https://github.com/expressjs/express", "TypeError: session is None"),
            Janitor().run("https://github.com/expressjs/express"),
            AskUmbra().run("https://github.com/expressjs/express", "Where is routing?"),
        )

    results = asyncio.run(run_all())
    assert {result.agent for result in results} == {"watchman", "reviewer", "detective", "janitor", "ask"}
    assert all(result.replay.prompt and result.replay.reasoning for result in results)
