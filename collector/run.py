"""Collect one ArcGIS organization into Postgres.

Reads one JSON job from stdin: portal_url, username, password, org_id, run_id.
DATABASE_URL comes from the environment. The password is never written anywhere.
"""

import hashlib
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

import psycopg
from psycopg.types.json import Jsonb

from agol import content, item_details, members, organization, people, usage
from agol.connect import connect_with, log, safely
from agol.groups import _all as all_group_rows
from agol.report import _blocked, _plain


def main():
    job = json.loads(sys.stdin.read())
    run_id = job["run_id"]
    org_id = job["org_id"]

    with psycopg.connect(os.environ["DATABASE_URL"], autocommit=True) as db:
        try:
            gis = connect_with(job["portal_url"], job["username"], job["password"])
            log("signed in")
            report = collect(gis, _item_cache(db, org_id))
            log("saving")
            with db.transaction():
                summary = store(db, org_id, run_id, report)
            finish(db, run_id, "succeeded", report["me"], summary, report["gaps"])
            log(f"done: {summary}")
        except Exception as exc:
            finish(db, run_id, "failed", None, None, [{"section": "collection", "error": str(exc)}])
            print(str(exc), file=sys.stderr)
            sys.exit(1)


# Run every script section. A failed section becomes its error text, not a crash.
def collect(gis, item_cache):
    me = gis.users.me
    search_stats = {}

    def run(name, fn):
        log(f"{name}: start")
        started = time.monotonic()
        value = _plain(safely(fn))
        size = f"{len(value)} rows" if isinstance(value, list) else "failed" if isinstance(value, str) else "done"
        log(f"{name}: {size} in {time.monotonic() - started:.1f}s")
        return value

    report = {
        "me": {"username": me.username, "role": me.role},
        "profile": run("profile", lambda: organization.profile(gis)),
        "security": run("security", lambda: organization.security(gis)),
        "maps": run("maps", lambda: organization.maps(gis)),
        "subscription": run("subscription", lambda: organization.subscription(gis)),
        "settings": run("settings", lambda: organization.settings(gis)),
        "counts": run("counts", lambda: members.counts(gis)),
        "roles": run("roles", lambda: members.roles(gis)),
        "invitations": run("invitations", lambda: members.invitations(gis)),
        "groups": run("groups", lambda: all_group_rows(gis)),
        "items": run("items", lambda: content.all_records(gis, search_stats)),
        "item_total": run("item total", lambda: content.item_total(gis)),
        "credits": run("credits", lambda: usage.credits(gis)),
        "licenses": run("licenses", lambda: usage.licenses(gis)),
        "storage": run("storage", lambda: usage.storage(gis)),
        "people": run("members", lambda: people.members(gis)),
        "role_names": run("role names", lambda: people.role_names(gis)),
        "type_names": run("user type names", lambda: people.user_type_names(gis)),
    }
    for section in ("groups", "items"):
        if isinstance(report[section], list):
            report[section] = [row for row in report[section] if isinstance(row, dict) and row.get("id")]
    if isinstance(report["groups"], list):
        report["group_details"] = run("group details", lambda: people.group_details(gis, report["groups"]))
    else:
        report["group_details"] = "Groups could not be listed."

    report["search_duplicates"] = search_stats.get("duplicates")
    if isinstance(report["items"], list):
        records = report["items"]
        report["items"] = [content.trim(record) for record in records]
        report["item_details"] = run("item details", lambda: item_details.collect(gis, records, item_cache))
        del records
    else:
        report["item_details"] = "Items could not be listed."

    gaps = []
    for section, value in report.items():
        if isinstance(value, str):
            gaps.append({"section": section, "error": value})
        elif isinstance(value, dict):
            for field, inner in value.items():
                if isinstance(inner, str) and _blocked(inner):
                    gaps.append({"section": f"{section}.{field}", "error": inner})
    if isinstance(report["group_details"], dict):
        for failure in report["group_details"].get("failed") or []:
            gaps.append({"section": f"group_details.{failure['group_id']}", "error": failure["error"]})
    if isinstance(report["item_details"], dict):
        for check in ("size", "dependencies", "empty", "usage"):
            result = report["item_details"].get(check)
            if not isinstance(result, dict):
                continue
            if result["stopped"]:
                gaps.append({"section": f"item_details.{check}",
                             "error": f"Stopped: {result['stopped']}. {result['left']} items left."})
            if result["failed"]:
                first = next(iter(result["failed"].values()))
                gaps.append({"section": f"item_details.{check}",
                             "error": f"{len(result['failed'])} items could not be read. First error: {first}"})
    report["gaps"] = gaps

    report["profile_read"] = isinstance(report["profile"], dict)
    if not report["profile_read"]:
        report["profile"] = {"url": gis.url}

    # Only an administrator sees every group, item, and invitation. For anyone
    # else, something missing from a scan may just be hidden, not deleted.
    report["full_view"] = me.role == "org_admin" or people.is_admin(me)
    return report


def store(db, org_id, run_id, r):
    now = datetime.now(timezone.utc)
    summary = {}

    if r["profile_read"]:
        _organization(db, org_id, r["profile"], now)
    else:
        db.execute(
            "update organizations set last_fetched_at = %s, updated_at = now() where org_id = %s",
            (now, org_id),
        )
    for section in ("security", "maps", "settings"):
        if isinstance(r[section], dict):
            _settings(db, org_id, section, r[section], now)
    if isinstance(r["subscription"], dict):
        _subscription(db, org_id, r["subscription"], now)

    roles = r["roles"] if isinstance(r["roles"], dict) else {}
    _roles(db, org_id, roles, now)
    counts = r["counts"] if isinstance(r["counts"], dict) else {}
    licenses = r["licenses"] if isinstance(r["licenses"], dict) else {}
    _user_types(db, org_id, counts, licenses, now)
    if isinstance(counts.get("total"), int):
        summary["members"] = counts["total"]

    full = r["full_view"]
    found = r["people"] if isinstance(r["people"], dict) else None
    db.execute(
        """update organizations set fetched_as_admin = %s,
             user_details_visible = coalesce(%s, user_details_visible)
           where org_id = %s""",
        (full, found["details_visible"] if found else None, org_id),
    )
    _app_settings(db, org_id)
    if found:
        _members(db, org_id, found["users"], r["role_names"], r["type_names"], now)
        summary["users"] = len(found["users"])

    if isinstance(r["invitations"], list):
        _invitations(db, org_id, r["invitations"], now, full)
        summary["invitations"] = len(r["invitations"])

    groups = r["groups"] if isinstance(r["groups"], list) else None
    items = r["items"] if isinstance(r["items"], list) else None
    _owners(db, org_id, r["me"], groups or [], items or [], now)

    if groups is not None:
        _groups(db, org_id, groups, now, full)
        summary["groups"] = len(groups)
    if items is not None:
        _items(db, org_id, items, now, full)
        _services(db, org_id, items, now)
        summary["items"] = len(items)
        if isinstance(r["item_details"], dict):
            summary["item_details"] = _item_details(db, org_id, items, r["item_details"], now)
    details = r["group_details"] if isinstance(r["group_details"], dict) else None
    if details:
        summary["memberships"] = _group_details(db, org_id, details["groups"], now)
    if found:
        _prune_users(db, org_id, found["users"])

    _licenses(db, org_id, licenses, now, full)
    summary["full_view"] = full
    if isinstance(r["credits"], dict):
        _credits(db, org_id, run_id, r["credits"], now)
    if isinstance(r["storage"], dict):
        _storage(db, org_id, run_id, r["storage"], now)

    baseline, changes = _track(db, org_id, run_id, r, now)
    summary["baseline"] = baseline
    summary["changes"] = changes

    for gap in r["gaps"]:
        db.execute(
            """insert into audit_coverage_gaps
                 (org_id, source_name, gap_start, gap_end, reason, severity, run_id)
               values (%s, %s, %s, %s, %s, %s, %s)""",
            (org_id, gap["section"], now, now, str(gap["error"])[:2000],
             "blocked" if _blocked(gap["error"]) else "error", run_id),
        )
    summary["gaps"] = len(r["gaps"])
    summary["checks"] = _checks(db, org_id, run_id, r)
    return summary


INACTIVE_DAYS = 90
RECENT_DAYS = 90


def _app_settings(db, org_id):
    db.cursor().executemany(
        """insert into app_settings (org_id, setting_name, setting_value) values (%s, %s, %s)
           on conflict (org_id, setting_name) do update set setting_value = excluded.setting_value""",
        [(org_id, "inactive_days", INACTIVE_DAYS), (org_id, "recent_days", RECENT_DAYS)],
    )


# Roles and user types must exist before users can point at them.
def _members(db, org_id, users, role_names, type_names, now):
    role_ids = {row["roleId"] for row in users if row.get("roleId")} | set(role_names)
    db.cursor().executemany(
        """insert into roles (org_id, role_id, name, is_custom, fetched_at) values (%s, %s, %s, %s, %s)
           on conflict (org_id, role_id) do update set name = excluded.name
             where roles.name = roles.role_id""",
        [(org_id, rid, role_names.get(rid) or f"Unknown role ({rid})", not people.is_builtin_role(rid), now)
         for rid in role_ids],
    )
    type_ids = {row["userLicenseTypeId"] for row in users if row.get("userLicenseTypeId")}
    db.cursor().executemany(
        """insert into user_types (org_id, user_type_id, name, fetched_at) values (%s, %s, %s, %s)
           on conflict (org_id, user_type_id) do update set name = excluded.name
             where user_types.name = user_types.user_type_id""",
        [(org_id, tid, type_names.get(tid) or tid, now) for tid in type_ids],
    )
    db.cursor().executemany(
        """insert into users
             (org_id, username, full_name, user_type_id, role_id, created_at, last_login_at,
              disabled, is_member, fetched_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s, true, %s)
           on conflict (org_id, username) do update set
             full_name = excluded.full_name, user_type_id = excluded.user_type_id,
             role_id = excluded.role_id, created_at = excluded.created_at,
             last_login_at = excluded.last_login_at, disabled = excluded.disabled,
             is_member = true, fetched_at = excluded.fetched_at""",
        [(org_id, row["username"], row.get("fullName"), row.get("userLicenseTypeId"), row.get("roleId"),
          _ts(row.get("created")), _ts(row.get("lastLogin")), bool(row.get("disabled")), now)
         for row in users],
    )


# People who left the org: no longer members, and removed unless they still own items or groups.
def _prune_users(db, org_id, users):
    names = [row["username"] for row in users]
    db.execute(
        "update users set is_member = false where org_id = %s and is_member and not (username = any(%s))",
        (org_id, names),
    )
    db.execute(
        """delete from users u where u.org_id = %s and not u.is_member
             and not exists (select 1 from items i where i.org_id = u.org_id and i.owner_username = u.username)
             and not exists (select 1 from groups g where g.org_id = u.org_id and g.owner_username = u.username)""",
        (org_id,),
    )


# Members and shared items of every group that was read; unread groups keep what they had.
def _group_details(db, org_id, details, now):
    read = list(details)
    db.execute("delete from group_members where org_id = %s and group_id = any(%s)", (org_id, read))
    db.execute("delete from item_group_shares where org_id = %s and group_id = any(%s)", (org_id, read))
    members = [(org_id, gid, username, role) for gid, d in details.items() for username, role in d["members"].items()]
    shares = [(org_id, item_id, gid, now) for gid, d in details.items() for item_id in dict.fromkeys(d["items"])]
    db.cursor().executemany(
        "insert into group_members (org_id, group_id, username, member_role) values (%s, %s, %s, %s)",
        members,
    )
    db.cursor().executemany(
        "insert into item_group_shares (org_id, item_id, group_id, observed_at) values (%s, %s, %s, %s)",
        shares,
    )
    db.cursor().executemany(
        "update groups set member_count = %s, item_count = %s where org_id = %s and group_id = %s",
        [(len(d["members"]), len(set(d["items"])), org_id, gid) for gid, d in details.items()],
    )
    return len(members)


# What is stored compared with what ArcGIS Online itself reports.
def _checks(db, org_id, run_id, r):
    rows = []

    def check(name, expected, actual, details=None):
        ok = expected == actual if expected is not None and actual is not None else None
        rows.append((org_id, run_id, name, expected, actual, ok, _json(details)))

    counts = r["counts"] if isinstance(r["counts"], dict) else {}
    found = r["people"] if isinstance(r["people"], dict) else None
    stored = db.execute(
        "select count(*) from users where org_id = %s and is_member", (org_id,)
    ).fetchone()[0]
    if found:
        check("Members stored vs ArcGIS member total", counts.get("total"), stored,
              {"method": found["method"]})

        for label, key, column in (("role", "roles", "role_id"), ("user type", "counts", "user_type_id")):
            source = r[key] if isinstance(r[key], dict) else {}
            live = source.get("counts") if key == "roles" else source.get("by_user_type")
            if not isinstance(live, list) or not found["details_visible"]:
                continue
            arcgis = {row.get("key"): _int(row.get("count")) or 0 for row in live if row.get("key")}
            ours = dict(db.execute(
                f"select {column}, count(*) from users where org_id = %s and is_member group by 1", (org_id,)
            ).fetchall())
            keys = sorted(set(arcgis) | {k for k in ours if k})
            differences = [{"key": k, "arcgis": arcgis.get(k, 0), "stored": ours.get(k, 0)}
                           for k in keys if arcgis.get(k, 0) != ours.get(k, 0)]
            check(f"Members per {label} match ArcGIS", len(keys), len(keys) - len(differences),
                  {"differences": differences} if differences else None)

    if isinstance(r["groups"], list):
        stored_groups = db.execute(
            "select count(*) from groups where org_id = %s and group_id = any(%s)",
            (org_id, [row["id"] for row in r["groups"]]),
        ).fetchone()[0]
        check("Groups stored vs groups listed", len(r["groups"]), stored_groups)
    details = r["group_details"] if isinstance(r["group_details"], dict) else None
    if details and isinstance(r["groups"], list):
        failed = details.get("failed") or []
        check("Groups whose members and items were read", len(r["groups"]), len(details["groups"]),
              {"failed": failed} if failed else None)
    if isinstance(r["items"], list):
        stored_items = db.execute(
            "select count(*) from items where org_id = %s and item_id = any(%s)",
            (org_id, [row["id"] for row in r["items"]]),
        ).fetchone()[0]
        check("Items stored vs items listed", len(r["items"]), stored_items)
        if isinstance(r["item_total"], int):
            check("Items listed vs ArcGIS item total", r["item_total"], len(r["items"]),
                  {"duplicate_search_results_removed": r.get("search_duplicates")})

    db.cursor().executemany(
        """insert into collection_checks (org_id, run_id, check_name, expected, actual, ok, details)
           values (%s, %s, %s, %s, %s, %s, %s)""",
        rows,
    )
    return {"passed": sum(1 for row in rows if row[5]), "total": len(rows)}


def _organization(db, org_id, p, now):
    arcgis_id = p.get("id")
    if arcgis_id:
        db.execute(
            "update organizations set arcgis_id = null where arcgis_id = %s and org_id <> %s",
            (arcgis_id, org_id),
        )
    db.execute(
        """update organizations set
             arcgis_id = %s, name = coalesce(%s, name), description = %s, region = %s,
             culture = %s, units = %s, access = %s, portal_name = %s, is_enterprise = %s,
             portal_mode = %s, portal_version = %s, read_only = %s,
             source_created_at = %s, source_modified_at = %s,
             last_fetched_at = %s, updated_at = now()
           where org_id = %s""",
        (arcgis_id, p.get("name"), p.get("description"), p.get("region"),
         p.get("culture"), p.get("units"), p.get("access"), p.get("portal_name"),
         _bool(p.get("is_enterprise")), p.get("portal_mode"), _text(p.get("portal_version")),
         _bool(p.get("read_only")), _ts(p.get("created")), _ts(p.get("modified")), now, org_id),
    )


def _settings(db, org_id, section, values, now):
    for name, value in values.items():
        if _blocked(value):
            continue
        db.execute(
            """insert into organization_settings (org_id, setting_name, section, setting_value, fetched_at)
               values (%s, %s, %s, %s, %s)
               on conflict (org_id, setting_name) do update
                 set section = excluded.section,
                     setting_value = excluded.setting_value,
                     fetched_at = excluded.fetched_at""",
            (org_id, name, section, _json(value), now),
        )


def _subscription(db, org_id, s, now):
    db.execute(
        """insert into subscriptions
             (org_id, subscription_id, type, state, expires_at, max_members,
              storage_region, user_license_types, fetched_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s)
           on conflict (org_id) do update set
             subscription_id = excluded.subscription_id, type = excluded.type,
             state = excluded.state, expires_at = excluded.expires_at,
             max_members = excluded.max_members, storage_region = excluded.storage_region,
             user_license_types = excluded.user_license_types, fetched_at = excluded.fetched_at""",
        (org_id, _text(s.get("id")), s.get("type"), s.get("state"), _ts(s.get("expiration")),
         _int(s.get("max_members")), s.get("storage_region"),
         _json(s.get("user_license_types")), now),
    )


def _roles(db, org_id, roles, now):
    definitions = roles.get("definitions")
    if isinstance(definitions, list):
        for row in definitions:
            if not row.get("id"):
                continue
            db.execute(
                """insert into roles (org_id, role_id, name, is_custom, privilege_count, fetched_at)
                   values (%s, %s, %s, %s, %s, %s)
                   on conflict (org_id, role_id) do update set
                     name = excluded.name, is_custom = excluded.is_custom,
                     privilege_count = excluded.privilege_count, fetched_at = excluded.fetched_at""",
                (org_id, row["id"], row.get("name") or row["id"], row.get("kind") == "custom",
                 _int(row.get("privileges")), now),
            )
    counted = roles.get("counts")
    if isinstance(counted, list):
        for row in counted:
            key = row.get("key")
            if not key:
                continue
            db.execute(
                """insert into roles (org_id, role_id, name, member_count, fetched_at)
                   values (%s, %s, %s, %s, %s)
                   on conflict (org_id, role_id) do update set
                     member_count = excluded.member_count, fetched_at = excluded.fetched_at""",
                (org_id, key, row.get("role") or key, _int(row.get("count")), now),
            )


def _merge_user_types(counts, licenses):
    merged = {}
    for row in counts.get("by_user_type") or []:
        if row.get("key"):
            merged.setdefault(row["key"], {})["assigned"] = _int(row.get("count"))
    for row in counts.get("seats") or []:
        if row.get("user_type"):
            entry = merged.setdefault(row["user_type"], {})
            entry["seats"] = _int(row.get("max_seats"))
            entry["assigned"] = _int(row.get("assigned"))
    types = licenses.get("user_types")
    if isinstance(types, list):
        for row in types:
            if row.get("id"):
                entry = merged.setdefault(row["id"], {})
                entry["name"] = row.get("name")
                if entry.get("seats") is None:
                    entry["seats"] = _int(row.get("max_users"))
    return merged


def _user_types(db, org_id, counts, licenses, now):
    for type_id, entry in _merge_user_types(counts, licenses).items():
        db.execute(
            """insert into user_types (org_id, user_type_id, name, purchased_seats, assigned_count, fetched_at)
               values (%s, %s, %s, %s, %s, %s)
               on conflict (org_id, user_type_id) do update set
                 name = excluded.name, purchased_seats = excluded.purchased_seats,
                 assigned_count = excluded.assigned_count, fetched_at = excluded.fetched_at""",
            (org_id, type_id, entry.get("name") or type_id, entry.get("seats"),
             entry.get("assigned"), now),
        )


def _invitations(db, org_id, rows, now, full):
    if full:
        db.execute("delete from invitations where org_id = %s", (org_id,))
    for index, row in enumerate(rows):
        row = row if isinstance(row, dict) else {"value": row}
        db.execute(
            """insert into invitations
                 (org_id, invitation_id, invited_email, invited_at, status, role,
                  user_type, expires_at, details, fetched_at)
               values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
               on conflict (org_id, invitation_id) do nothing""",
            (org_id, _text(row.get("id")) or f"invitation-{index}", row.get("email"),
             _ts(row.get("created")), row.get("status"), row.get("role"),
             row.get("userLicenseType") or row.get("userType"), _ts(row.get("expiration")),
             Jsonb(row), now),
        )


# Owners must exist as users before groups and items can point at them.
def _owners(db, org_id, me, groups, items, now):
    names = {me["username"]}
    names.update(row["owner"] for row in groups if row.get("owner"))
    names.update(row["owner"] for row in items if row.get("owner"))
    db.cursor().executemany(
        """insert into users (org_id, username, fetched_at) values (%s, %s, %s)
           on conflict (org_id, username) do nothing""",
        [(org_id, name, now) for name in names],
    )
    db.execute(
        "update users set role = %s where org_id = %s and username = %s",
        (me.get("role"), org_id, me["username"]),
    )


def _groups(db, org_id, rows, now, full):
    db.cursor().executemany(
        """insert into groups
             (org_id, group_id, title, owner_username, access, created_at, modified_at,
              is_invitation_only, is_view_only, protected, auto_join, tags, fetched_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           on conflict (org_id, group_id) do update set
             title = excluded.title, owner_username = excluded.owner_username,
             access = excluded.access, created_at = excluded.created_at,
             modified_at = excluded.modified_at, is_invitation_only = excluded.is_invitation_only,
             is_view_only = excluded.is_view_only, protected = excluded.protected,
             auto_join = excluded.auto_join, tags = excluded.tags, fetched_at = excluded.fetched_at""",
        [
            (org_id, row["id"], row.get("title") or row["id"], row.get("owner"), row.get("access"),
             _ts(row.get("created")), _ts(row.get("modified")), _bool(row.get("isInvitationOnly")),
             _bool(row.get("isViewOnly")), _bool(row.get("protected")), _bool(row.get("autoJoin")),
             _texts(row.get("tags")), now)
            for row in rows
        ],
    )
    if full:
        db.execute(
            "delete from groups where org_id = %s and not (group_id = any(%s))",
            (org_id, [row["id"] for row in rows]),
        )


def _items(db, org_id, rows, now, full):
    db.cursor().executemany(
        """insert into items
             (org_id, item_id, title, type, owner_username, access, created_at, modified_at,
              views, completeness_score, content_status, description, snippet, tags,
              thumbnail_url, num_comments, num_ratings, avg_rating, type_keywords, url, fetched_at,
              size_bytes)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
           on conflict (org_id, item_id) do update set
             title = excluded.title, type = excluded.type, owner_username = excluded.owner_username,
             access = excluded.access, created_at = excluded.created_at,
             modified_at = excluded.modified_at, views = excluded.views,
             completeness_score = excluded.completeness_score,
             content_status = excluded.content_status, description = excluded.description,
             snippet = excluded.snippet, tags = excluded.tags,
             thumbnail_url = excluded.thumbnail_url, num_comments = excluded.num_comments,
             num_ratings = excluded.num_ratings, avg_rating = excluded.avg_rating,
             type_keywords = excluded.type_keywords, url = excluded.url,
             fetched_at = excluded.fetched_at,
             size_bytes = coalesce(excluded.size_bytes, items.size_bytes)""",
        [
            (org_id, row["id"], row.get("title") or row["id"], row.get("type") or "Unknown",
             row.get("owner"), row.get("access"), _ts(row.get("created")), _ts(row.get("modified")),
             _int(row.get("numViews")), _num(row.get("scoreCompleteness")), row.get("contentStatus"),
             row.get("description"), row.get("snippet"), _texts(row.get("tags")), row.get("thumbnail"),
             _int(row.get("numComments")), _int(row.get("numRatings")), _num(row.get("avgRating")),
             _texts(row.get("typeKeywords")), row.get("url"), now, _size_bytes(row.get("size")))
            for row in rows
        ],
    )
    if full:
        db.execute(
            "delete from items where org_id = %s and not (item_id = any(%s))",
            (org_id, [row["id"] for row in rows]),
        )


# Same hosted / referenced / tiled rules as content.services, kept per item.
def _services(db, org_id, rows, now):
    db.execute(
        "delete from item_services where org_id = %s and item_id = any(%s)",
        (org_id, [row["id"] for row in rows]),
    )
    records = []
    for row in rows:
        kind = row.get("type") or ""
        if kind not in content.SERVICE_TYPES:
            continue
        words = [str(word).lower() for word in (row.get("typeKeywords") or [])]
        hosted = "hosted service" in words
        records.append((
            org_id, row["id"], kind, row.get("url"), hosted,
            (not hosted) and bool(row.get("url")),
            kind == "Map Service" and "tiled" in words, now,
        ))
    db.cursor().executemany(
        """insert into item_services
             (org_id, item_id, service_type, service_url, hosted, referenced, tiled, detected_at)
           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
        records,
    )


def _size_bytes(value):
    size = _int(value)
    return size if size is not None and size >= 0 else None


# {check: {item_id: (modified in ms, checked_at, ok)}} from earlier collections.
def _item_cache(db, org_id):
    cache = {}
    rows = db.execute(
        """select check_name, item_id, item_modified_at, checked_at, ok, error
           from item_checks where org_id = %s""",
        (org_id,),
    ).fetchall()
    for check, item_id, modified, checked_at, ok, error in rows:
        # Failures from unsupported relationship lookups (now skipped) are read again right away.
        if not ok and error and "ArcGIS Portal Directory" in error:
            continue
        modified_ms = int(modified.timestamp() * 1000) if modified else None
        cache.setdefault(check, {})[item_id] = (modified_ms, checked_at, ok)
    return cache


# Results of the per-item reads. Items not read this time keep what they had.
def _item_details(db, org_id, rows, details, now):
    modified = {row["id"]: _ts(row.get("modified")) for row in rows}
    checks, summary = [], {}
    for check in ("size", "dependencies", "empty", "usage"):
        result = details.get(check)
        if not isinstance(result, dict):
            continue
        done = {key: value for key, value in result["done"].items() if key in modified}
        failed = {key: value for key, value in result["failed"].items() if key in modified}
        checks += [(org_id, key, check, modified[key], now, True, None) for key in done]
        checks += [(org_id, key, check, modified[key], now, False, error) for key, error in failed.items()]
        summary[check] = {"read": len(done), "failed": len(failed), "left": result["left"]}
        ids = list(done)

        if check == "size":
            db.cursor().executemany(
                "update items set size_bytes = %s where org_id = %s and item_id = %s",
                [(size, org_id, key) for key, size in done.items()],
            )
        elif check == "empty":
            db.cursor().executemany(
                "update items set is_empty = %s where org_id = %s and item_id = %s",
                [(bool(empty), org_id, key) for key, empty in done.items()],
            )
        elif check == "dependencies":
            db.execute("delete from item_dependencies where org_id = %s and item_id = any(%s)", (org_id, ids))
            with db.cursor().copy(
                "copy item_dependencies (org_id, item_id, dependency_item_id, detected_at) from stdin"
            ) as copy:
                for key, found in done.items():
                    for dependency in found:
                        copy.write_row((org_id, key, dependency, now))
        elif check == "usage":
            db.cursor().executemany(
                "update items set usage_30d = %s where org_id = %s and item_id = %s",
                [(value["total"], org_id, key) for key, value in done.items()],
            )
            db.execute("delete from item_usage where org_id = %s and item_id = any(%s)", (org_id, ids))
            with db.cursor().copy(
                "copy item_usage (org_id, item_id, usage_date, usage_count, fetched_at) from stdin"
            ) as copy:
                for key, value in done.items():
                    per_day = {}
                    for stamp, count in value["days"]:
                        day = datetime.fromtimestamp(stamp / 1000, tz=timezone.utc).date()
                        per_day[day] = per_day.get(day, 0) + count
                    for day, count in per_day.items():
                        if count:
                            copy.write_row((org_id, key, day, count, now))

    db.cursor().executemany(
        """insert into item_checks (org_id, item_id, check_name, item_modified_at, checked_at, ok, error)
           values (%s, %s, %s, %s, %s, %s, %s)
           on conflict (org_id, item_id, check_name) do update set
             item_modified_at = excluded.item_modified_at, checked_at = excluded.checked_at,
             ok = excluded.ok, error = excluded.error""",
        checks,
    )
    return summary


# (license_id, name, kind, assigned) rows, and the kinds that were readable this run.
def _license_rows(licenses):
    rows = []
    readable = set()
    add_ons = licenses.get("add_ons")
    if isinstance(add_ons, list):
        readable.add("add_on")
        rows += [(f"add_on:{title}", title, "add_on", None) for title in add_ons if title]
    for kind in ("apps", "bundles"):
        listed = licenses.get(kind)
        if isinstance(listed, list):
            readable.add(kind[:-1])
            for row in listed:
                key = row.get("key")
                if key:
                    name = row.get("secondaryKey") or key
                    rows.append((f"{kind[:-1]}:{key}", name, kind[:-1], _int(row.get("count"))))
    return rows, readable


def _licenses(db, org_id, licenses, now, full):
    rows, _ = _license_rows(licenses)
    if not rows:
        return
    if full:
        db.execute("delete from licenses where org_id = %s", (org_id,))
    db.cursor().executemany(
        """insert into licenses (org_id, license_id, license_name, license_kind, assigned_count, fetched_at)
           values (%s, %s, %s, %s, %s, %s)
           on conflict (org_id, license_id) do update set
             license_name = excluded.license_name, license_kind = excluded.license_kind,
             assigned_count = excluded.assigned_count, fetched_at = excluded.fetched_at""",
        [(org_id, license_id, name, kind, count, now) for license_id, name, kind, count in rows],
    )


def _credits(db, org_id, run_id, c, now):
    db.execute(
        """insert into credit_snapshots
             (org_id, collected_at, balance, budgeting_enabled, default_limit,
              member_count, sum_of_default_caps, run_id)
           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
        (org_id, now, _num(c.get("balance")), _bool(c.get("budgeting_enabled")),
         _num(c.get("default_limit")), _int(c.get("members")), _num(c.get("sum_of_default_caps")), run_id),
    )
    spent = c.get("used_last_30_days")
    if isinstance(spent, dict):
        start = now - timedelta(days=30)
        db.cursor().executemany(
            """insert into credit_usage (org_id, period_start, period_end, category, credits_used, fetched_at, run_id)
               values (%s, %s, %s, %s, %s, %s, %s)""",
            [
                (org_id, start, now, category, _num(amount), now, run_id)
                for category, amount in spent.items()
                if _num(amount) is not None
            ],
        )


def _storage(db, org_id, run_id, s, now):
    feature = s.get("feature_data_store") if isinstance(s.get("feature_data_store"), dict) else {}
    db.execute(
        """insert into storage_snapshots
             (org_id, collected_at, used_bytes, quota_bytes, feature_store_percent, feature_store_at, run_id)
           values (%s, %s, %s, %s, %s, %s, %s)""",
        (org_id, now, _int(s.get("used_bytes")), _int(s.get("quota_bytes")),
         _num(feature.get("percent")), _ts(feature.get("at")), run_id),
    )


# Every tracked entity as {(entity_type, entity_id): (state, label)}, plus the
# entity types read in full this run. Deletions are only inferred for those.
def _entities(r):
    current = {}
    complete = set()
    scopes = set()

    def add(kind, key, state, label=None):
        current[(kind, str(key))] = (state, label)

    full = r["full_view"]

    if r["profile_read"]:
        complete.add("organization")
        add("organization", "profile", r["profile"], r["profile"].get("name"))

    for section, kind in (("security", "security_setting"), ("maps", "map_setting"), ("settings", "org_setting")):
        if isinstance(r[section], dict):
            readable = {name: value for name, value in r[section].items() if not _blocked(value)}
            if len(readable) == len(r[section]):
                complete.add(kind)
            for name, value in readable.items():
                add(kind, name, {"value": value}, name)

    if isinstance(r["subscription"], dict):
        complete.add("subscription")
        add("subscription", "subscription", r["subscription"], r["subscription"].get("type"))

    roles = r["roles"] if isinstance(r["roles"], dict) else {}
    definitions = roles.get("definitions")
    counted = roles.get("counts")
    merged_roles = {}
    if isinstance(definitions, list):
        for row in definitions:
            if row.get("id"):
                merged_roles.setdefault(row["id"], {}).update(
                    name=row.get("name"), kind=row.get("kind"), privileges=row.get("privileges"))
    if isinstance(counted, list):
        for row in counted:
            if row.get("key"):
                entry = merged_roles.setdefault(row["key"], {})
                entry.setdefault("name", row.get("role"))
                entry["members"] = row.get("count")
    if isinstance(definitions, list) and isinstance(counted, list):
        complete.add("role")
    for key, state in merged_roles.items():
        add("role", key, state, state.get("name"))

    counts = r["counts"] if isinstance(r["counts"], dict) else {}
    licenses = r["licenses"] if isinstance(r["licenses"], dict) else {}
    if isinstance(counts.get("by_user_type"), list):
        complete.add("user_type")
    for key, state in _merge_user_types(counts, licenses).items():
        add("user_type", key, state, state.get("name"))
    if isinstance(counts.get("total"), int):
        add("members", "total", {"total": counts["total"]}, "Member total")

    if isinstance(r["invitations"], list):
        if full:
            complete.add("invitation")
        for index, row in enumerate(r["invitations"]):
            row = row if isinstance(row, dict) else {"value": row}
            key = row.get("id") or row.get("email") or f"invitation-{index}"
            add("invitation", key, row, row.get("email"))

    if isinstance(r["groups"], list):
        if full:
            complete.add("group")
        for row in r["groups"]:
            add("group", row["id"], row, row.get("title"))

    if isinstance(r["items"], list):
        if full:
            complete.add("item")
        for row in r["items"]:
            add("item", row["id"], {key: value for key, value in row.items() if key != "size"}, row.get("title"))

    rows, readable = _license_rows(licenses)
    if full:
        complete.update(f"license_{kind}" for kind in readable)
    for license_id, name, kind, assigned in rows:
        add(f"license_{kind}", license_id, {"name": name, "assigned": assigned}, name)

    # Last login changes all the time; it is stored on the user, not tracked as history.
    found = r["people"] if isinstance(r["people"], dict) else None
    if found:
        if found["method"] == "member list":
            complete.add("user")
        for row in found["users"]:
            add("user", row["username"], {
                "full_name": row.get("fullName"),
                "user_type": row.get("userLicenseTypeId"),
                "role": row.get("roleId"),
                "disabled": bool(row.get("disabled")),
            }, row.get("fullName") or row["username"])

    # Members and shares are complete only for the groups that were read.
    details = r["group_details"] if isinstance(r["group_details"], dict) else None
    if details:
        titles = {row["id"]: row.get("title") for row in r["groups"]} if isinstance(r["groups"], list) else {}
        for gid, d in details["groups"].items():
            title = titles.get(gid) or gid
            scopes.add(("group_member", gid))
            scopes.add(("group_share", gid))
            for username, role in d["members"].items():
                add("group_member", f"{gid}:{username}", {"role": role}, f"{username} in {title}")
            for item_id in d["items"]:
                add("group_share", f"{gid}:{item_id}", {"shared": True}, f"{item_id} in {title}")
        if full and not details.get("failed"):
            complete.update({"group_member", "group_share"})

    return current, complete, scopes


def _hash(state):
    raw = json.dumps(state, sort_keys=True, default=str, separators=(",", ":"))
    return hashlib.sha256(raw.encode("utf-8")).hexdigest()


# Compare this scan with the last snapshot of each entity. The first scan is the
# baseline: it saves snapshots but writes no history.
def _track(db, org_id, run_id, r, now):
    current, complete, scopes = _entities(r)
    previous = {}
    rows = db.execute(
        """select distinct on (entity_type, entity_id)
             entity_type, entity_id, state_json, state_hash, is_present
           from entity_snapshots
           where org_id = %s
           order by entity_type, entity_id, observed_at desc""",
        (org_id,),
    ).fetchall()
    for kind, key, state, digest, present in rows:
        previous[(kind, key)] = (state, digest, present)
    baseline = not previous

    # A kind seen for the first time (for example users, once that was added) is its own baseline.
    known_kinds = {kind for kind, _ in previous}
    snapshots = []
    changes = []

    def change(kind, key, action, field, old, new, label):
        changes.append((
            org_id, kind, key, action, field, _json(old), _json(new), now, "api_poll", run_id,
            _json({"label": label} if label else None),
        ))

    for (kind, key), (state, label) in current.items():
        digest = _hash(state)
        prev = previous.get((kind, key))
        if prev and prev[2] and prev[1] == digest:
            continue
        snapshots.append((org_id, kind, key, now, Jsonb(state), digest, run_id, True))
        if baseline or kind not in known_kinds:
            continue
        if not prev or not prev[2]:
            change(kind, key, "created", None, None, state, label)
            continue
        old = prev[0] if isinstance(prev[0], dict) else {}
        for field in sorted(set(old) | set(state)):
            if old.get(field) != state.get(field):
                name = key if kind.endswith("_setting") and field == "value" else field
                change(kind, key, "updated", name, old.get(field), state.get(field), label)

    for (kind, key), (state, digest, present) in previous.items():
        if not present or (kind, key) in current:
            continue
        if kind not in complete and (kind, key.split(":", 1)[0]) not in scopes:
            continue
        snapshots.append((org_id, kind, key, now, Jsonb(state), digest, run_id, False))
        if not baseline:
            label = state.get("title") or state.get("name") if isinstance(state, dict) else None
            change(kind, key, "deleted", None, state, None, label or key)

    db.cursor().executemany(
        """insert into entity_snapshots
             (org_id, entity_type, entity_id, observed_at, state_json, state_hash, run_id, is_present)
           values (%s, %s, %s, %s, %s, %s, %s, %s)""",
        snapshots,
    )
    db.cursor().executemany(
        """insert into change_history
             (org_id, entity_type, entity_id, action, field_name, old_value, new_value,
              detected_at, source, run_id, details_json)
           values (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s)""",
        changes,
    )
    return baseline, len(changes)


def finish(db, run_id, status, me, summary, gaps):
    processed = 0
    if summary:
        processed = (summary.get("items") or 0) + (summary.get("groups") or 0)
    db.execute(
        """update report_runs set
             finished_at = now(), status = %s, items_processed = %s, errors = %s,
             summary = %s, error_details = %s,
             signed_in_username = coalesce(%s, signed_in_username),
             signed_in_role = coalesce(%s, signed_in_role)
           where run_id = %s""",
        (status, processed, len(gaps or []), _json(summary), Jsonb(gaps or []),
         (me or {}).get("username"), (me or {}).get("role"), run_id),
    )


def _ts(value):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or value <= 0:
        return None
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
    except (OverflowError, OSError, ValueError):
        return None


def _int(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _num(value):
    if isinstance(value, bool) or value is None:
        return None
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _bool(value):
    return value if isinstance(value, bool) else None


def _json(value):
    return None if value is None else Jsonb(value)


def _text(value):
    return None if value is None else str(value)


def _texts(value):
    return [str(item) for item in value] if isinstance(value, list) else None


if __name__ == "__main__":
    main()
