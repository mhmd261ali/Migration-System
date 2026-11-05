"""Member totals, roles, and invitations."""

from collections.abc import Mapping

from agol.connect import safely

BUILTIN_ROLES = {
    "org_admin": "Administrator",
    "org_publisher": "Publisher",
    "org_user": "User",
}

DEFAULT_ROLE_IDS = {
    "iAAAAAAAAAAAAAAA",
    "iBBBBBBBBBBBBBBB",
    "iCCCCCCCCCCCCCCC",
}


# Member total, user types, and seats still open.
def counts(gis):
    frame = gis.users.counts("user_type", as_df=True)
    assigned = dict(zip(frame["key"], frame["count"]))
    allocated = (gis.subscription_information or {}).get("userLicenseTypes") or {}
    if not isinstance(allocated, Mapping):
        allocated = {}

    seats = []
    for type_id, cap in allocated.items():
        used = int(assigned.get(type_id, 0))
        seats.append({
            "user_type": type_id,
            "max_seats": int(cap),
            "assigned": used,
            "remaining": int(cap) - used,
        })

    return {
        "total": int(frame["count"].sum()),
        "by_user_type": frame.to_dict("records"),
        "seats": seats,
    }


# Role definitions and how many members sit in each role.
def roles(gis):
    definitions = safely(lambda: _definitions(gis))
    counted = safely(lambda: gis.users.counts("role", as_df=True).to_dict("records"))

    if isinstance(counted, list):
        names = {}
        if isinstance(definitions, list):
            names = {row["id"]: row["name"] for row in definitions}
        for row in counted:
            key = row.get("key")
            row["role"] = names.get(key) or BUILTIN_ROLES.get(key, key)
        counted.sort(key=lambda row: row.get("count") or 0, reverse=True)

    return {"definitions": definitions, "counts": counted}


# Name, id, and privilege count for every role.
def _definitions(gis):
    rows = []
    for role in gis.users.roles.all(max_roles=1000):
        role_id = getattr(role, "role_id", None)
        rows.append({
            "name": getattr(role, "name", None),
            "id": role_id,
            "kind": "default" if role_id in DEFAULT_ROLE_IDS else "custom",
            "privileges": len(getattr(role, "privileges", None) or []),
        })
    return rows


# Email invitations that have not been accepted yet.
def invitations(gis):
    return safely(lambda: list(gis.users.invitations.list()))
