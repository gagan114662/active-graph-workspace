"""Correct email/twitter tools (positive control)."""
import re
class CommsRefused(Exception): pass
SECRET_RE = re.compile(r"(sk-ant-[A-Za-z0-9-]{6,}|sk-[A-Za-z0-9]{16,}|whsec_[A-Za-z0-9_]+|AKIA[0-9A-Z]{16}|xoxb-[0-9A-Za-z-]+|ghp_[A-Za-z0-9]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY)")
def send_email(to, *, user, emit):
    trusted = user.get("email")
    if not isinstance(to, str) or to != trusted:
        raise CommsRefused(f"recipient {to!r} != trusted {trusted!r}")
    emit("email.sent", {"to": to})
def post_tweet(text, *, emit):
    if not isinstance(text, str) or SECRET_RE.search(text):
        raise CommsRefused("refused: secret-like content in tweet")
    emit("tweet.posted", {"text": text})
