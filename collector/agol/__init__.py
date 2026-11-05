# Import collect only when asked, so `python -m agol.report` does not load it twice.
def __getattr__(name):
    if name == "collect":
        from agol.report import collect
        return collect
    raise AttributeError(f"module 'agol' has no attribute {name}")
