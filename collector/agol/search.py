"""Walk a search past the 10,000-result cap, by creation time."""

from datetime import datetime, timedelta, timezone


# Page a search by creation time so the 10,000 limit does not cut it off. Each
# page starts at the last creation time seen, so results repeat at the edges;
# they are kept once, by id. stats["duplicates"] counts the repeats dropped.
def by_created(fetch, batch_size=1000, stats=None):
    found = {}
    duplicates = 0
    cursor = 0
    end = int((datetime.now(timezone.utc) + timedelta(days=3650)).timestamp() * 1000)

    while True:
        batch = fetch(cursor, end, batch_size)
        if not batch:
            break

        before = len(found)
        for record in batch:
            if record["id"] in found:
                duplicates += 1
            found[record["id"]] = record

        if len(batch) < batch_size:
            break
        if len(found) == before:
            raise RuntimeError("Pagination stopped on one creation timestamp.")
        cursor = max(record["created"] for record in batch)

    if stats is not None:
        stats["duplicates"] = duplicates
    return list(found.values())
