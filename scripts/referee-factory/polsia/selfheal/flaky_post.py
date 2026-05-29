"""A Polsia comms tool that has DRIFTED — post_tweet now raises (e.g. Twitter removed
the old client). Contract: post_tweet(text) should return {"status":"posted","text":text}."""
def post_tweet(text):
    return OldTwitterClient().publish(text)   # NameError: OldTwitterClient was removed (API drift)
