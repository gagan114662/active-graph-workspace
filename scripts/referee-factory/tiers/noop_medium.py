"""NO-OP control for the MEDIUM tier. Builds a run with NO behaviors and NO custom
ontology — just a goal that idles. Its store MUST FAIL accept_medium.py. If the
independent acceptance passed on this empty run, the acceptance would be vacuous
and every VERIFIED meaningless. Prints the store URL.

Usage: python noop_medium.py
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

from activegraph import Graph, Runtime, clear_registry  # noqa: E402

clear_registry()  # deliberately register NOTHING — no ontology, no reactive behavior
work = Path(tempfile.mkdtemp(prefix="noop-medium-"))
db_url = f"sqlite:///{work / 'noop.db'}"
graph = Graph()
rt = Runtime(graph, persist_to=db_url, budget={"max_events": 50})
rt.run_goal("do nothing of substance")
rt.save_state()
print(db_url)
