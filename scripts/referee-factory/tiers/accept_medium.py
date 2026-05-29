"""INDEPENDENT sealed acceptance for the MEDIUM tier (custom ontology + reactive
behavior proposing+applying a Patch). Authored by the referee, NOT by the builder.
Reads the event store the builder produced and asserts the capability invariant
from the event log alone. A lenient self-check cannot satisfy this; a no-op store
fails it (see noop_medium.py).

Usage: python accept_medium.py <sqlite-store-url>
Exit 0 + "INDEP_ACCEPT_PASS" if the capability is genuinely present; else exit 1.
"""
from __future__ import annotations

import os
import sys

os.environ.pop("ANTHROPIC_API_KEY", None)
os.environ.pop("OPENAI_API_KEY", None)

from activegraph import Runtime  # noqa: E402

db_url = sys.argv[1]
rt = Runtime.load(db_url)  # replay the persisted log -> rebuild graph + events
events = list(rt.graph.events)
types = [e.type for e in events]
fails: list[str] = []

# 1. custom-typed ontology actually created (arbitrary string types, no base schema)
claims = [o for o in rt.graph.all_objects() if o.type == "claim"]
tasks = [o for o in rt.graph.all_objects() if o.type == "task"]
if not claims:
    fails.append("no custom 'claim' object in the graph")
if not tasks:
    fails.append("no custom 'task' object in the graph")

# 2. typed relation
try:
    deps = rt.graph.get_relations(type="depends_on")
except Exception:
    deps = [r for r in rt.graph.all_relations() if r.type == "depends_on"]
if not deps:
    fails.append("no typed 'depends_on' relation")

# 3. a Patch was proposed AND applied (the reactive mutation actually happened)
if "patch.proposed" not in types:
    fails.append("event log has no patch.proposed")
if "patch.applied" not in types:
    fails.append("event log has no patch.applied")

# 4. the patch was REACTIVE: a patch.proposed caused_by an object.created(claim)
caused_ok = False
for p in (e for e in events if e.type == "patch.proposed"):
    cause = next((e for e in events if e.id == p.caused_by), None)
    if cause is not None and cause.type == "object.created":
        obj = cause.payload.get("object", {}) if isinstance(cause.payload, dict) else {}
        if obj.get("type") == "claim":
            caused_ok = True
            break
if not caused_ok:
    fails.append("no patch.proposed caused_by an object.created(claim) — not reactive")

# 5. it stayed offline (no LLM calls — fixtures only)
if "llm.requested" in types:
    fails.append("unexpected llm.requested (should be offline)")

# 6. a claim object was actually mutated (version bumped past 1)
if claims and not any(o.version > 1 for o in claims):
    fails.append("no claim object had its version bumped by a patch")

if fails:
    print("INDEP_ACCEPT_FAIL")
    for f in fails:
        print("  -", f)
    sys.exit(1)
print("INDEP_ACCEPT_PASS:", len(events), "events, claim/task ontology + reactive patch verified independently")
sys.exit(0)
