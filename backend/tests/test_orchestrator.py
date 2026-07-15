import asyncio

from backend.orchestrator import EventBus, Orchestrator


def test_demo_scan_works_without_network():
    result = asyncio.run(Orchestrator().scan("https://github.com/acme/demo"))
    assert result["repo_url"] == "https://github.com/acme/demo"
    assert result["umbra_score"] == 82
    assert result["vulnerabilities"]


def test_event_bus_replays_and_streams():
    async def scenario():
        bus = EventBus()
        await bus.emit({"message": "first"})
        stream = bus.stream()
        first = await anext(stream)
        await stream.aclose()
        return first

    assert asyncio.run(scenario()) == {"message": "first"}
