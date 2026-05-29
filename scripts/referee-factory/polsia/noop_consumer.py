"""No-drain control: registers a consumer that does nothing. Tasks stay queued -> FAIL."""
from activegraph import behavior
def register_consumer():
    @behavior(name="consumer", on=["object.created"], where={"object.type": "task"})
    def consumer(event, graph, ctx):
        return  # never drains the queue
