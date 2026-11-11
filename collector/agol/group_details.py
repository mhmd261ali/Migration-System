"""One group's members and shared items (from Groups overview/group_details.ipynb).

Members come from the group's userList resource and items from the group content
listing, not search, so the 10,000-result search cap does not apply and the
lists are complete.
"""

import random
import time

RETRYABLE_STATUS_CODES = {429, 502, 503, 504}
PAGE_SIZE = 100

GROUP_FIELDS = [
    "id", "title", "owner", "description", "snippet", "tags", "typeKeywords", "phone",
    "categories", "created", "modified", "access", "sortField", "sortOrder",
    "isInvitationOnly", "isViewOnly", "isReadOnly", "protected", "autoJoin",
    "notificationsEnabled", "hiddenMembers", "leavingDisallowed", "membershipAccess",
    "capabilities", "featuredItemsId", "thumbnail", "displaySettings", "orgId",
    "provider", "providerGroupName", "properties", "collaborationInfo",
]

MEMBER_FIELDS = ["username", "fullName", "memberType", "joined"]

ITEM_FIELDS = [
    "id", "owner", "ownerId", "title", "name", "type", "created", "modified", "description",
    "snippet", "tags", "typeKeywords", "url", "access", "thumbnail", "extent",
    "spatialReference", "accessInformation", "licenseInfo", "culture", "guid", "numViews",
    "numComments", "numRatings", "avgRating", "lastViewed", "scoreCompleteness",
    "groupCategories", "source",
]


class SharingAPIError(RuntimeError):
    pass


class InconsistentResultsError(RuntimeError):
    pass


def pick(record, fields):
    if isinstance(record, dict):
        return {field: record.get(field) for field in fields}
    return {field: getattr(record, field, None) for field in fields}


def _rest_root(gis):
    resturl = getattr(getattr(gis, "_portal", None), "resturl", None)
    return resturl.rstrip("/") if resturl else f"{gis.url.rstrip('/')}/sharing/rest"


# Authenticated GET through the GIS session, retrying temporary failures with backoff.
def sharing_get(gis, path, params, attempts=4):
    url = f"{_rest_root(gis)}{path}"
    query = dict(params, f="json")
    last_error = None
    for attempt in range(attempts):
        try:
            response = gis._con.get(url, query)
        except Exception as exc:
            last_error = exc
            if attempt == attempts - 1:
                raise
            time.sleep(2 ** attempt + random.random())
            continue
        if not isinstance(response, dict):
            raise SharingAPIError("Sharing API returned a non-JSON response.")
        error = response.get("error")
        if error:
            code = error.get("code") if isinstance(error, dict) else None
            if code in RETRYABLE_STATUS_CODES and attempt < attempts - 1:
                time.sleep(2 ** attempt + random.random())
                continue
            raise SharingAPIError(error)
        return response
    raise SharingAPIError(last_error)


# {"owner": {username, fullName}, "users": [MEMBER_FIELDS...]}
def members(gis, group_id):
    path = f"/community/groups/{group_id}/userList"
    start, owner, users, expected = 1, None, [], None
    while True:
        response = sharing_get(gis, path, {"start": start, "num": PAGE_SIZE})
        if owner is None:
            owner = response.get("owner") or {}
        if "total" in response:
            total = int(response["total"])
            if expected is None:
                expected = total
            elif total != expected:
                raise InconsistentResultsError("The reported member total changed during pagination.")
        batch = response.get("users") or []
        if not isinstance(batch, list):
            raise InconsistentResultsError("Invalid users list in userList response.")
        users.extend(batch)
        next_start = int(response.get("nextStart", -1))
        if next_start == -1:
            break
        if next_start <= start:
            raise InconsistentResultsError("Member pagination stopped advancing.")
        start = next_start
    if expected is not None and len(users) != expected:
        raise InconsistentResultsError(f"Expected {expected} members, retrieved {len(users)}.")
    return {"owner": pick(owner, ["username", "fullName"]), "users": [pick(user, MEMBER_FIELDS) for user in users]}


# {item_id: ITEM_FIELDS...} for every item shared with the group. Retried once if inconsistent.
def items(gis, group_id):
    for attempt in range(2):
        try:
            return _items_once(gis, group_id)
        except InconsistentResultsError:
            if attempt == 1:
                raise


def _items_once(gis, group_id):
    path = f"/content/groups/{group_id}"
    start, found, expected = 1, {}, None
    while True:
        response = sharing_get(gis, path, {"start": start, "num": PAGE_SIZE})
        if "items" not in response or "total" not in response:
            raise InconsistentResultsError("Unexpected response from Group Content endpoint.")
        total = int(response["total"])
        if expected is None:
            expected = total
        elif total != expected:
            raise InconsistentResultsError("The reported item total changed during pagination.")
        for item in response["items"] or []:
            if not item.get("id"):
                raise InconsistentResultsError("An item record is missing its ID.")
            found[item["id"]] = pick(item, ITEM_FIELDS)
        next_start = int(response.get("nextStart", -1))
        if next_start == -1:
            break
        if next_start <= start:
            raise InconsistentResultsError("Item pagination stopped advancing.")
        start = next_start
    if len(found) != expected:
        raise InconsistentResultsError(f"Expected {expected} items, retrieved {len(found)}.")
    return found
