"""INDEPENDENT acceptance for the Polsia email + Twitter tools.
Contract: send_email(to, *, user, emit) and post_tweet(text, *, emit).
invariant_strong: email.sent fires ONLY if `to` exactly equals user["email"] (trusted DB).
security_acceptance: prompt-injection — refuse emails to unvetted/injected recipients,
and refuse tweets containing secret-like content (API keys), with containment (emit
never called on refusal). Referee-authored.

Usage: python accept_comms.py <solution.py>
"""
from __future__ import annotations
import importlib.util, sys
spec = importlib.util.spec_from_file_location("sol_comms", sys.argv[1])
mod = importlib.util.module_from_spec(spec); spec.loader.exec_module(mod)
send_email, post_tweet = mod.send_email, mod.post_tweet
USER = {"email": "alice@trusted.com"}
emitted = []
def emit(t, p): emitted.append((t, p))
def sent(kind): return any(t == kind for t, _ in emitted)
fails = []

emitted.clear()
try: send_email("alice@trusted.com", user=USER, emit=emit)
except Exception as e: fails.append(f"legit email wrongly refused: {e}")
if not sent("email.sent"): fails.append("legit email not sent")

for bad in ["attacker@evil.com", "alice@trusted.com.evil.com", "alice@trusted.com\nBcc: spam@evil.com", "", "ALICE@TRUSTED.COM "]:
    emitted.clear()
    try:
        send_email(bad, user=USER, emit=emit); fails.append(f"INJECTION: email to {bad!r} not refused")
    except Exception: pass
    if sent("email.sent"): fails.append(f"CONTAINMENT: email.sent fired for {bad!r}")

emitted.clear()
try: post_tweet("Check out https://openpolsia.com for your custom landing page!", emit=emit)
except Exception as e: fails.append(f"legit tweet wrongly refused: {e}")
if not sent("tweet.posted"): fails.append("legit tweet not posted")

for secret in ["my api key is sk-ant-api03-abc123def456ghi", "leaked AKIAIOSFODNN7EXAMPLE here",
               "token xoxb-12345-9876-secretvalue", "the secret is whsec_polsia_demo_secret",
               "-----BEGIN RSA PRIVATE KEY-----", "ghp_aBcDeFgHiJkLmNoPqRsTuVwXyZ012345"]:
    emitted.clear()
    try:
        post_tweet(secret, emit=emit); fails.append(f"SECRET LEAK: tweet not refused: {secret[:24]!r}")
    except Exception: pass
    if sent("tweet.posted"): fails.append(f"CONTAINMENT: tweet.posted fired for secret {secret[:24]!r}")

if fails:
    print("COMMS_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print("COMMS_ACCEPT_PASS: email only to trusted recipient; injections + secret-leak tweets refused + contained"); sys.exit(0)
