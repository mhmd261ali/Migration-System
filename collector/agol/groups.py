"""Organization groups."""

from agol.search import by_created

FIELDS = [
    "id",
    "title",
    "owner",
    "access",
    "isInvitationOnly",
    "isViewOnly",
    "protected",
    "autoJoin",
    "created",
    "modified",
    "tags",
]


# Every group, and how many are public, org, or private.
def all_groups(gis):
    records = _all(gis)
    access = {}
    for row in records:
        key = row.get("access")
        access[key] = access.get(key, 0) + 1
    return {"count": len(records), "by_access": access}


# Download every group, 1,000 at a time.
def _all(gis):
    org_id = gis.properties.id

    # One page of groups, oldest first.
    def fetch(cursor, end, size):
        batch = gis.groups.search(
            query=f"orgid:{org_id} AND created:[{cursor} TO {end}]",
            sort_field="created",
            sort_order="asc",
            max_groups=size,
        )
        rows = []
        for group in batch:
            raw = dict(group)
            row = {field: raw.get(field) for field in FIELDS}
            row["id"] = row["id"] or group.id
            row["created"] = group.created if row["created"] is None else row["created"]
            rows.append(row)
        return rows

    return by_created(fetch)
