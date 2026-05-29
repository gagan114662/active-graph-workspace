"""Naive email/twitter tools (negative control): sends to anyone, posts anything. Must FAIL."""
def send_email(to, *, user, emit): emit("email.sent", {"to": to})
def post_tweet(text, *, emit): emit("tweet.posted", {"text": text})
