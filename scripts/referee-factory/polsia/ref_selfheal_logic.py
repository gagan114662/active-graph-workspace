"""Correct triage detector (positive control)."""
def should_remediate(events):
    return any(getattr(e, "type", None) == "behavior.failed" for e in events)
