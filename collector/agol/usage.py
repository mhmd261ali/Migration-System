"""Credits, licenses, and storage."""

from agol.connect import safely


# Credit balance, spend over the last 30 days, and the default member cap.
def credits(gis):
    manager = safely(lambda: gis.admin.credits)
    if isinstance(manager, str):
        return manager

    usage = safely(lambda: manager.credit_usage(time_frame="30days"))
    member_count = safely(lambda: int(gis.users.counts("user_type", as_df=True)["count"].sum()))
    limit = manager.default_limit
    cap_sum = None
    if not isinstance(member_count, str) and limit not in (None, -1):
        cap_sum = member_count * limit

    return {
        "balance": manager.credits,
        "budgeting_enabled": manager.is_enabled,
        "default_limit": limit,
        "used_last_30_days": usage,
        "members": member_count,
        "sum_of_default_caps": cap_sum,
    }


# User types, add-on licenses, and how many members hold each app.
def licenses(gis):
    return {
        "user_types": safely(lambda: _user_types(gis)),
        "add_ons": safely(lambda: _add_ons(gis)),
        "apps": safely(lambda: gis.users.counts("app", as_df=True).to_dict("records")),
        "bundles": safely(lambda: gis.users.counts("bundles", as_df=True).to_dict("records")),
    }


# Purchased user-type seats.
def _user_types(gis):
    rows = []
    for item in gis.users.license_types or []:
        rows.append({
            "id": item.get("id"),
            "name": item.get("name"),
            "max_users": item.get("maxUsers"),
        })
    return rows


# Names of the add-on licenses.
def _add_ons(gis):
    rows = []
    for item in gis.admin.license.all():
        props = getattr(item, "properties", {}) or {}
        listing = props.get("listing") if hasattr(props, "get") else None
        title = listing.get("title") if hasattr(listing, "get") else None
        rows.append(title or str(item))
    return rows


# Organization storage quota, bytes used, and the feature data store.
def storage(gis):
    try:
        me = gis.users.me
        quota = int(me.storageQuota or 0)
        used = int(me.storageUsage or 0)
    except Exception as exc:
        return str(exc)
    return {
        "quota_bytes": quota,
        "used_bytes": used,
        "quota_tb": round(quota / (1024 ** 4), 2),
        "used_tb": round(used / (1024 ** 4), 2),
        "percent_used": round(used / quota * 100, 1) if quota else None,
        "feature_data_store": safely(lambda: _feature_store(gis)),
    }


# How full the hosted feature database is.
def _feature_store(gis):
    series = gis.admin.datastore_metrics.feature_storage or []
    if not series:
        return None
    latest = series[0]
    return {"percent": latest.get("value"), "at": latest.get("ts")}
