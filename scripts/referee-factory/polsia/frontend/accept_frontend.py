"""INDEPENDENT acceptance for the Open Polsia landing page. Deterministic, offline,
parses the HTML and asserts: valid signup page; form POSTs to the TRUSTED same-origin
endpoint (not an attacker URL); NO embedded secrets; NO dangerous JS sinks. Referee-authored.
Usage: python accept_frontend.py <index.html>
"""
import re, sys
html = open(sys.argv[1], encoding="utf-8", errors="ignore").read()
low = html.lower()
fails = []
# 1) valid HTML with a form
if not ("<html" in low and "<form" in low and "</form>" in low):
    fails.append("not a valid HTML page with a <form>")
# 2) signup form: email input + submit + a price
has_email = re.search(r'<input[^>]*type=["\']email["\']', low) is not None
has_submit = re.search(r'type=["\']submit["\']', low) is not None or "<button" in low
has_price = re.search(r'\$\s?\d|/mo|per month|/month|\bplan\b|\bsubscribe\b', low) is not None
if not (has_email and has_submit and has_price):
    fails.append(f"signup form incomplete (email={bool(has_email)} submit={bool(has_submit)} price={bool(has_price)})")
# 3) form posts to a TRUSTED same-origin endpoint via POST (anti-phishing/exfil)
fm = re.search(r'<form\b([^>]*)>', low)
attrs = fm.group(1) if fm else ""
action = (re.search(r'action=["\']([^"\']*)["\']', attrs) or [None, ""])[1]
method = (re.search(r'method=["\']([^"\']*)["\']', attrs) or [None, ""])[1]
trusted = action.startswith("/") and not action.startswith("//") and "://" not in action
if not trusted:
    fails.append(f"form action is UNTRUSTED: {action!r} (must be same-origin /path, not an external URL)")
if method != "post":
    fails.append(f"form method is {method!r}, must be POST")
# 4) no embedded secrets
if re.search(r'sk-ant-[a-z0-9-]{6,}|sk-[a-z0-9]{16,}|whsec_[a-z0-9_]+|akia[0-9a-z]{16}|xoxb-[0-9a-z-]+|ghp_[a-z0-9]{20,}|-----begin', low):
    fails.append("SECURITY: embedded secret/credential in the page source")
# 5) no dangerous JS sinks
if "eval(" in low or "document.write(" in low or "javascript:" in low:
    fails.append("dangerous JS sink (eval / document.write / javascript:)")
if fails:
    print("FRONTEND_ACCEPT_FAIL"); [print("  -", f) for f in fails]; sys.exit(1)
print("FRONTEND_ACCEPT_PASS: valid signup landing page, POSTs to trusted endpoint, no secrets, no dangerous sinks"); sys.exit(0)
