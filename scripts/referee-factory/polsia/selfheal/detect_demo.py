import os, importlib.util
os.environ.pop("ANTHROPIC_API_KEY", None); os.environ.pop("OPENAI_API_KEY", None)
from activegraph import Graph, Runtime, behavior, clear_registry
S = "/Users/gaganarora/Desktop/my projects/active_graph/scripts/referee-factory/polsia/selfheal"
def run(modfile):
    spec = importlib.util.spec_from_file_location("pm", S + "/" + modfile); m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
    clear_registry()
    @behavior(name="planner", on=["goal.created"])
    def planner(e, g, c): g.add_object("task", {"status": "queued", "text": "hi"})
    @behavior(name="tweeter", on=["object.created"], where={"object.type": "task"})
    def tweeter(e, g, c): m.post_tweet(e.payload["object"]["data"]["text"])
    rt = Runtime(Graph(), budget={"max_events": 100}); rt.run_goal("tweet")
    return [e.type for e in rt.graph.events]
broken = run("flaky_post.py"); fixed = run("ref_fixed_post.py")
print("broken behavior.failed:", broken.count("behavior.failed"), "| external triage detects:", "behavior.failed" in broken)
print("fixed  behavior.failed:", fixed.count("behavior.failed"))
