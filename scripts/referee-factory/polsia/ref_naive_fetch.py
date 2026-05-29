"""Naive fetcher (negative control): fetches ANY url, no SSRF check. Must FAIL."""
def safe_fetch(url, *, resolve=None, fetch=None):
    f = fetch or (lambda u: __import__("urllib.request", fromlist=["urlopen"]).urlopen(u).read())
    return f(url)
