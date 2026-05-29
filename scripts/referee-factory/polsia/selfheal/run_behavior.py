"""Run a behavior that calls post_tweet from a given module; print behavior.failed count."""
import os, sys, importlib.util
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry
spec = importlib.util.spec_from_file_location("pm", sys.argv[1]); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
clear_registry()
@behavior(name="planner", on=["goal.created"])
def planner(e, g, c): g.add_object("task", {"status": "queued", "text": "launch day"})
@behavior(name="tweeter", on=["object.created"], where={"object.type": "task"})
def tweeter(e, g, c): m.post_tweet(e.payload["object"]["data"]["text"])
rt = Runtime(Graph(), budget={"max_events": 100}); rt.run_goal("tweet")
print(sum(1 for ev in rt.graph.events if ev.type == "behavior.failed"))
