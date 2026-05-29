"""Open Polsia comms tools — Agentic Access for email + Twitter.

Security model: a prompt-injected agent must NOT be able to email strangers
or leak secrets. Both functions are "refuse before emit" — on any policy
violation we raise BEFORE calling emit(), so the dangerous action is never
recorded.

Pure stdlib (re). Self-contained.
"""

import re


class ContainmentError(Exception):
    """Raised when a comms action is refused for safety reasons.

    Raised strictly BEFORE emit() so the dangerous action is never recorded.
    """


# --------------------------------------------------------------------------
# Email: strict allow-list of exactly one recipient (the registered user).
# --------------------------------------------------------------------------

# A header-injection guard: any control / line-break / separator char that
# could smuggle an extra header (Bcc:, To:, CC:) into a downstream mailer.
_HEADER_INJECTION = re.compile(r"[\r\n\t\x00-\x1f\x7f]")


def send_email(to, *, user, emit):
    """Send an email ONLY to the registered user's own address.

    Allow-list of exactly one: ``to`` must be a ``str`` that EXACTLY equals
    ``user["email"]`` (byte-for-byte). Any deviation — a different address,
    a look-alike domain, injected newlines / Bcc, an empty string, or a
    case / whitespace variant — is refused.

    Refusal raises ``ContainmentError`` BEFORE ``emit`` is ever called.
    """
    # --- validate the trusted side first (defensive; user is "trusted") ---
    if not isinstance(user, dict):
        raise ContainmentError("user must be a dict with a trusted 'email'.")
    allowed = user.get("email")
    if not isinstance(allowed, str) or not allowed:
        raise ContainmentError("user['email'] missing or not a non-empty string.")

    # --- validate the untrusted recipient ---
    if not isinstance(to, str):
        raise ContainmentError("recipient 'to' must be a string.")
    if to == "":
        raise ContainmentError("refusing to send to an empty recipient.")

    # Header / Bcc injection: newlines, tabs, NULs, other control chars.
    # Checked explicitly even though exact-match below would also reject most
    # of these — keeps the intent (and the failure message) unambiguous.
    if _HEADER_INJECTION.search(to):
        raise ContainmentError("recipient contains control/newline chars (header injection).")

    # The one and only rule: EXACT, byte-for-byte equality with the
    # registered address. No casefold, no strip, no normalization — a
    # look-alike or whitespace/case variant is a different string and is
    # therefore refused.
    if to != allowed:
        raise ContainmentError(
            "recipient is not the registered user; refusing (allow-list of one)."
        )

    # Safe: recipient is exactly the registered user.
    emit("email.sent", {"to": to})


# --------------------------------------------------------------------------
# Twitter: refuse to post anything containing secret-like content.
# --------------------------------------------------------------------------

# Patterns that look like real credentials. We deliberately err toward
# refusing (a prompt-injected agent leaking a key is far worse than a
# false-positive blocked tweet). Anthropic key is listed before the generic
# OpenAI ``sk-`` form, but the generic form would catch it anyway.
_SECRET_PATTERNS = [
    re.compile(r"sk-ant-[A-Za-z0-9_\-]{6,}"),          # Anthropic API key
    re.compile(r"sk-[A-Za-z0-9_\-]{8,}"),              # OpenAI API key
    re.compile(r"whsec_[A-Za-z0-9_\-]{6,}"),           # Stripe webhook secret
    re.compile(r"AKIA[0-9A-Z]{12,}"),                  # AWS access key id
    re.compile(r"xoxb-[0-9A-Za-z\-]{6,}"),             # Slack bot token
    re.compile(r"ghp_[A-Za-z0-9]{16,}"),               # GitHub personal token
    re.compile(                                         # PEM private key header
        r"-----BEGIN[ A-Z0-9]* PRIVATE KEY",
        re.IGNORECASE,
    ),
]


def post_tweet(text, *, emit):
    """Post a tweet ONLY if it contains no secret-like content.

    If ``text`` matches any known secret pattern (OpenAI / Anthropic key,
    Stripe webhook secret, AWS key, Slack token, GitHub token, or a PEM
    private-key header) we raise ``ContainmentError`` BEFORE ``emit`` is
    ever called. This stops a prompt-injected agent from leaking secrets.
    """
    if not isinstance(text, str):
        raise ContainmentError("tweet text must be a string.")

    for pattern in _SECRET_PATTERNS:
        if pattern.search(text):
            raise ContainmentError(
                "refusing to post: tweet contains secret-like content."
            )

    # Safe: no secret pattern detected.
    emit("tweet.posted", {"text": text})
