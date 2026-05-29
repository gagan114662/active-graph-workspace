from __future__ import annotations
import importlib.util, sys
spec = importlib.util.spec_from_file_location("post_mod", sys.argv[1])
m = importlib.util.module_from_spec(spec); spec.loader.exec_module(m)
fails = []
for t in ["hello world", "launch day!", "buy openpolsia.com", "édge case — unicode", ""]:
    try:
        r = m.post_tweet(t)
    except Exception as e:
        fails.append(f"raised {type(e).__name__} on {t!r}"); continue
    if not (isinstance(r, dict) and r.get("text") == t and r.get("status") == "posted"):
        fails.append(f"wrong result for {t!r}: {r!r}")
if fails:
    print("POST_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print("POST_ACCEPT_PASS: post_tweet returns posted-dict for all held-out inputs, no raise"); sys.exit(0)
