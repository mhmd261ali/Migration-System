"""Items, a short summary, and hosted versus referenced services."""

import pandas as pd

from agol.search import by_created

SERVICE_TYPES = [
    "Feature Service",
    "Map Service",
    "Image Service",
    "Vector Tile Service",
    "Scene Service",
]

FIELDS = [
    "id",
    "title",
    "type",
    "owner",
    "access",
    "created",
    "modified",
    "numViews",
    "numComments",
    "numRatings",
    "avgRating",
    "scoreCompleteness",
    "contentStatus",
    "description",
    "snippet",
    "tags",
    "thumbnail",
    "typeKeywords",
    "url",
    "size",
]


# Every item in the organization.
def all_items(gis):
    return [trim(record) for record in all_records(gis)]


# Every item as the full search record, plus how many repeated results paging dropped.
def all_records(gis, stats=None):
    org_id = gis.properties.id

    # One page of items, oldest first.
    def fetch(cursor, end, size):
        response = gis.content.advanced_search(
            query=f"orgid:{org_id} AND created:[{cursor} TO {end}]",
            max_items=size,
            sort_field="created",
            sort_order="asc",
            start=1,
            as_dict=True,
        )
        return response["results"]

    return by_created(fetch, stats=stats)


# What ArcGIS Online says the item total is, to check the paged list against.
def item_total(gis):
    return int(gis.content.advanced_search(query=f"orgid:{gis.properties.id}", return_count=True))


def trim(record):
    return {field: record.get(field) for field in FIELDS}


# Counts for types, sharing, views, completeness, and missing text.
def summary(records):
    frame = pd.DataFrame(records)
    if frame.empty:
        return {"total": 0}

    views = pd.to_numeric(frame["numViews"], errors="coerce")
    scores = pd.to_numeric(frame["scoreCompleteness"], errors="coerce")
    return {
        "total": len(frame),
        "by_type": frame["type"].value_counts().to_dict(),
        "by_access": frame["access"].value_counts().to_dict(),
        "public_items": int((frame["access"] == "public").sum()),
        "views": int(views.fillna(0).sum()),
        "average_views": round(float(views.mean()), 2) if views.notna().any() else None,
        "average_completeness": round(float(scores.mean()), 2) if scores.notna().any() else None,
        "missing_description": _blank(frame["description"]),
        "missing_summary": _blank(frame["snippet"]),
        "missing_tags": int(frame["tags"].apply(lambda value: not isinstance(value, list) or len(value) == 0).sum()),
        "missing_thumbnail": _blank(frame["thumbnail"]),
    }


# Hosted services, referenced services, and tiled map services.
def services(records):
    counts = {name: 0 for name in SERVICE_TYPES}
    other = {}
    hosted = referenced = tiled = 0

    for item in records:
        kind = item.get("type") or ""
        if kind not in counts:
            if "Service" in kind:
                other[kind] = other.get(kind, 0) + 1
            continue

        counts[kind] += 1
        words = [str(word).lower() for word in (item.get("typeKeywords") or [])]
        if kind == "Map Service" and "tiled" in words:
            tiled += 1
        if "hosted service" in words:
            hosted += 1
        elif item.get("url"):
            referenced += 1

    return {
        "by_type": counts,
        "other": other,
        "hosted": hosted,
        "referenced": referenced,
        "tiled_map_services": tiled,
    }


# How many values in a column are empty.
def _blank(series):
    return int(series.fillna("").astype(str).str.strip().eq("").sum())
