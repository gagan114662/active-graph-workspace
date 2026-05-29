"""No-op detector (negative control): never detects a failure. Must FAIL — failures go unnoticed, no self-heal."""
def should_remediate(events):
    return False
