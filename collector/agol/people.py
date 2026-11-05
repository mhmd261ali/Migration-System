"""Members, role and user-type names, and group members and shared items (from org_data.py)."""

import re
import time
from concurrent.futures import ThreadPoolExecutor, as_completed

from arcgis.gis import Group

from agol.connect import log
from agol.search import by_created

MAX_USERS = 10_000_000
MEMBER_LIMIT_S = 15 * 60
GROUP_WORKERS = 8

# Roles every ArcGIS Online org has; roles.all() never returns the org_* ones.
BUILTIN_ROLES = {
    "org_admin": "Administrator",
    "org_publisher": "Publisher",
    "org_user": "User",
    "iAAAAAAAAAAAAAAA": "Viewer",
    "iBBBBBBBBBBBBBBB": "Data Editor",
}

# Esri's lineup since June 2024; official names need admin rights.
USER_TYPE_NAMES = {
    "viewerUT": "Viewer",
    "editorUT": "Contributor",
    "contributorUT": "Contributor",
    "fieldWorkerUT": "Mobile Worker",
    "mobileWorkerUT": "Mobile Worker",
    "creatorUT": "Creator",
    "GISProfessionalBasicUT": "GIS Professional Basic (legacy)",
    "GISProfessionalStdUT": "Professional",
    "GISProfessionalAdvUT": "Professional Plus",
    "storytellerUT": "Storyteller",
    "insightsAnalystUT": "Insights Analyst",
}

USER_FIELDS = ["username", "fullName", "userLicenseTypeId", "roleId", "created", "lastLogin", "disabled"]


# org_* roles and templates: "i" followed by the same capital letter 15 times.
def is_builtin_role(role_id):
    return role_id in BUILTIN_ROLES or re.fullmatch(r"i([A-Z])\1{14}", role_id or "") is not None


def role_names(gis):
    names = dict(BUILTIN_ROLES)
    try:
        for role in gis.users.roles.all(max_roles=1000):
            names[role.role_id] = role.name
    except Exception:
        pass
    return names


def user_type_names(gis):
    names = dict(USER_TYPE_NAMES)
    try:
        for license_type in gis.users.license_types:
            if license_type.get("id") and license_type.get("name"):
                names[license_type["id"]] = license_type["name"]
    except Exception:
        pass
    return names


def is_admin(me):
    return "portal:admin:viewUsers" in (getattr(me, "privileges", None) or [])


# Every member from the org's member list (no 10,000 cap); fallback: search split by created date.
def members(gis):
    try:
        raw = _member_pages(gis)
        method = "member list"
    except Exception as exc:
        log(f"  member list refused ({str(exc)[:120]}); searching by created date")
        org_id = gis.properties.id

        def fetch(cursor, end, size):
            response = gis.users.advanced_search(
                f"orgid:{org_id} AND created:[{cursor:019d} TO {end:019d}]",
                max_users=size,
                sort_field="created",
                sort_order="asc",
                as_dict=True,
            )
            return [dict(row, id=row.get("username")) for row in response["results"]]

        raw = by_created(fetch)
        method = f"search split by created date (member list refused: {str(exc)[:120]})"

    rows = {}
    for user in raw:
        if user.get("username"):
            rows[user["username"]] = {field: user.get(field) for field in USER_FIELDS}
    users = list(rows.values())
    return {
        "users": users,
        "method": method,
        "details_visible": any(user.get("lastLogin") is not None for user in users),
    }


# The org member list, 100 per page. arcgis's own loop can keep asking for the same
# page forever, so this one stops when a page is empty or does not move forward.
def _member_pages(gis):
    users, start = [], 1
    deadline = time.monotonic() + MEMBER_LIMIT_S
    while len(users) < MAX_USERS:
        if time.monotonic() > deadline:
            raise TimeoutError(f"Member list not finished after {MEMBER_LIMIT_S // 60} minutes ({len(users)} read).")
        page = gis._portal._org_users_page(start, 100, exclude_system=False)
        batch = page.get("users") or []
        users.extend(batch)
        if len(users) // 1000 != (len(users) - len(batch)) // 1000:
            log(f"  members: {len(users)} of {page.get('total', '?')}")
        next_start = int(page.get("nextStart") or -1)
        if not batch or next_start <= start:
            break
        start = next_start
    log(f"  members: {len(users)} read")
    return users


# Members (one role each: owner > admin > member) and shared item ids for every group.
def group_details(gis, groups):
    def read(row):
        group = Group(gis, row["id"])
        found = group.get_members() or {}
        roles = {username: "member" for username in found.get("users") or []}
        roles.update({username: "admin" for username in found.get("admins") or []})
        if found.get("owner"):
            roles[found["owner"]] = "owner"
        return {"members": roles, "items": _group_item_ids(gis, row["id"])}

    details, failed = {}, []
    with ThreadPoolExecutor(max_workers=GROUP_WORKERS) as pool:
        futures = {pool.submit(read, row): row for row in groups}
        for done, future in enumerate(as_completed(futures), start=1):
            row = futures[future]
            try:
                details[row["id"]] = future.result()
                log(f"  group {done}/{len(futures)}: {row.get('title')} · "
                    f"{len(details[row['id']]['members'])} members, {len(details[row['id']]['items'])} items")
            except Exception as exc:
                failed.append({"group_id": row["id"], "title": row.get("title"), "error": str(exc)[:200]})
                log(f"  group {done}/{len(futures)}: {row.get('title')} failed: {str(exc)[:120]}")
    return {"groups": details, "failed": failed}


def _group_item_ids(gis, group_id):
    def fetch(cursor, end, size):
        response = gis.content.advanced_search(
            query=f"group:{group_id} AND created:[{cursor} TO {end}]",
            max_items=size,
            sort_field="created",
            sort_order="asc",
            start=1,
            as_dict=True,
        )
        return [{"id": item["id"], "created": item.get("created")} for item in response["results"]]

    return [row["id"] for row in by_created(fetch)]
