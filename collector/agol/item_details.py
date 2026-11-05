"""Per-item reads from items/functions.py: size, dependencies, empty check, usage.

Each costs one or more API calls per item, so they run in parallel, use the
item_checks cache (only new, changed, or due items are read), and stop at a time
budget per check. Whatever is left is read by the next collection.
"""

import time
from concurrent.futures import FIRST_COMPLETED, ThreadPoolExecutor, wait
from datetime import datetime, timedelta, timezone

from arcgis.apps.itemgraph._get_dependencies import _RELATIONSHIPS, _get_item_dependencies
from arcgis.gis import Item

from agol.connect import log

WORKERS = 10
# Seconds per check; None reads every due item in one collection.
BUDGET_S = {"size": 2 * 60, "dependencies": None, "empty": 3 * 60, "usage": 6 * 60}
RETRY_FAILED = timedelta(days=7)
USAGE_EVERY = timedelta(hours=20)
USAGE_RANGE = "30D"
# When this many reads in a row fail at the start, the account cannot read this check.
GIVE_UP_AFTER = 40

EMPTY_TYPES = {"Web Map", "Feature Service", "Feature Collection", "CSV", "Map Service"}
# Types whose own data lists the items they use (the arcgis item graph parsers).
PARSED_TYPES = {
    "Web Map", "Web Scene", "Dashboard", "Web Experience", "Web Mapping Application", "StoryMap",
    "Hub Site Application", "Hub Page", "Geoprocessing Service", "QuickCapture Project",
}


# Item.get_data returns {} when the read fails, which would look like an empty map
# or an item with no dependencies. This one lets the error through.
class _Item(Item):
    def get_data(self, try_json=True):
        data = self._portal.get_item_data(self.itemid, try_json, None)
        return None if data in ("", b"") else data


# {check: {"done": {id: value}, "failed": {id: error}, "due": n, "left": n, "stopped": reason}}
def collect(gis, records, cache):
    now = datetime.now(timezone.utc)
    by_id = {row["id"]: row for row in records}
    results = {}

    sized = [row for row in records if not _search_size(row)]
    results["size"] = _run(gis, "size", sized, cache, now, _size)

    results["dependencies"] = _run(gis, "dependencies", records, cache, now, _dependencies,
                                   first=lambda row: row.get("type") not in PARSED_TYPES)

    empties = [row for row in records if row.get("type") in EMPTY_TYPES]
    results["empty"] = _run(gis, "empty", empties, cache, now, _empty)

    results["usage"] = _run(gis, "usage", records, cache, now, _usage, usage=True)

    for check, result in results.items():
        log(f"item {check}: {len(result['done'])} read, {len(result['failed'])} failed, "
            f"{result['left']} left for the next collection"
            + (f", stopped: {result['stopped']}" if result["stopped"] else ""))
    results["searched"] = len(by_id)
    return results


# Items due for this check, the ones never read first.
def _due(check, rows, cache, now, usage=False, first=None):
    seen = cache.get(check) or {}
    fresh, changed, retry = [], [], []
    for row in rows:
        prev = seen.get(row["id"])
        if prev is None:
            fresh.append(row)
            continue
        modified_ms, checked_at, ok = prev
        if not ok:
            if now - checked_at > RETRY_FAILED:
                retry.append((checked_at, row))
        elif usage:
            if now - checked_at > USAGE_EVERY:
                changed.append((checked_at, row))
        elif modified_ms != row.get("modified"):
            changed.append((checked_at, row))
    if first:
        fresh.sort(key=first)
    changed.sort(key=lambda pair: pair[0])
    retry.sort(key=lambda pair: pair[0])
    return fresh + [row for _, row in changed] + [row for _, row in retry]


def _run(gis, check, rows, cache, now, fn, usage=False, first=None):
    queue = _due(check, rows, cache, now, usage, first)
    budget = BUDGET_S[check]
    deadline = time.monotonic() + budget if budget else float("inf")
    done, failed = {}, {}
    stopped = None
    log(f"item {check}: {len(queue)} due")

    pending = iter(queue)
    with ThreadPoolExecutor(max_workers=WORKERS) as pool:
        running = {}

        def fill():
            while len(running) < WORKERS * 2 and not stopped and time.monotonic() < deadline:
                row = next(pending, None)
                if row is None:
                    return
                running[pool.submit(fn, gis, row)] = row["id"]

        fill()
        while running:
            finished, _ = wait(running, return_when=FIRST_COMPLETED)
            for future in finished:
                item_id = running.pop(future)
                try:
                    done[item_id] = future.result()
                except Exception as exc:
                    failed[item_id] = (str(exc) or type(exc).__name__)[:500]
            if not done and len(failed) >= GIVE_UP_AFTER and not stopped:
                stopped = f"the first {len(failed)} reads all failed ({next(iter(failed.values()))})"
                for future in running:
                    future.cancel()
            processed = len(done) + len(failed)
            if processed and processed % 500 == 0:
                log(f"item {check}: {processed}/{len(queue)}")
            fill()

    if stopped:
        failed = {}
    elif time.monotonic() >= deadline and len(done) + len(failed) < len(queue):
        stopped = f"time budget of {budget // 60} minutes reached"
    return {
        "done": done,
        "failed": failed,
        "due": len(queue),
        "left": len(queue) - len(done) - len(failed),
        "stopped": stopped,
    }


def _search_size(row):
    size = row.get("size")
    return isinstance(size, (int, float)) and size >= 0


# Search reports -1 for some items; the item itself has the size.
def _size(gis, row):
    size = gis._portal.get_item(row["id"]).get("size")
    if not isinstance(size, (int, float)) or size < 0:
        raise ValueError("ArcGIS reports no size for this item.")
    return int(size)


# Immediate dependencies: what the item's data references plus its forward
# relationships. Ids for items, URLs for services without an item.
def _dependencies(gis, row):
    kind = row.get("type")
    item = _Item(gis, row["id"], dict(row))
    found = []
    if kind in PARSED_TYPES:
        found += _get_item_dependencies(item, gis, include_related=False) or []
    relations = list(_RELATIONSHIPS.get(kind, {}).get("forward", []))
    if kind == "Feature Service" and "View Service" not in (row.get("typeKeywords") or []):
        relations = [name for name in relations if name != "Service2Service"]
    if kind == "Solution":
        relations.append("Solution2Item")
    for relation in relations:
        if (kind, relation) in _UNSUPPORTED:
            continue
        try:
            found += [related.itemid for related in item.related_items(relation, direction="forward")]
        except Exception as exc:
            if "ArcGIS Portal Directory" not in str(exc):
                raise
            _UNSUPPORTED.add((kind, relation))
            log(f"item dependencies: {relation} on {kind} is not available here; skipping it")
    return [dep for dep in dict.fromkeys(str(value) for value in found if value) if dep != row["id"]]


# Relationship lookups ArcGIS Online answers with its bare directory page instead of
# JSON (Web Map relationships exist only on ArcGIS Enterprise). Not asked again.
_UNSUPPORTED = set()


# Fatima's rules: a map with no layers, a service with no layers or tables, an
# empty feature collection, a 0-byte CSV.
def _empty(gis, row):
    kind = row.get("type")
    if kind == "CSV":
        return row.get("size") == 0
    if kind in ("Feature Service", "Map Service"):
        if not row.get("url"):
            raise ValueError("The item has no service URL.")
        info = gis._con.get(row["url"], {"f": "json"})
        return not info.get("layers") and not info.get("tables")
    data = _Item(gis, row["id"], dict(row)).get_data()
    if not isinstance(data, dict):
        raise ValueError("The item data could not be read.")
    if kind == "Web Map":
        return not data.get("operationalLayers")
    return not data.get("layers")


# Total and daily usage over USAGE_RANGE. ArcGIS only shows it to the owner and administrators.
def _usage(gis, row):
    response = _Item(gis, row["id"], dict(row)).usage(date_range=USAGE_RANGE, as_df=False)
    if not isinstance(response, dict):
        raise PermissionError("ArcGIS returned no usage (only the owner and administrators can read it).")
    if "error" in response:
        raise RuntimeError(str(response["error"]))
    days = []
    for series in response.get("data") or []:
        for stamp, count in series.get("num") or []:
            days.append((int(stamp), int(count)))
    return {"total": sum(count for _, count in days), "days": days}
