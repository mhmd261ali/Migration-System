"""Users and groups (org_data.ipynb) and items (items/functions.py) analysis, as JSON or as an Excel file.

    python report_export.py <org_id> json [row_limit]   -> JSON on stdout
    python report_export.py <org_id> xlsx               -> .xlsx bytes on stdout

DATABASE_URL comes from the environment. Everything is read from v_users, v_groups, and v_items.
"""

import io
import json
import os
import sys
from datetime import date, datetime
from decimal import Decimal

import pandas as pd
import psycopg
from openpyxl.styles.numbers import BUILTIN_FORMATS
from openpyxl.utils import get_column_letter

TOP_N = 5
STALE_DAYS = 365
RANK_LIMIT = 1000
SHORT_DATE = BUILTIN_FORMATS[14]
SHORT_DATETIME = BUILTIN_FORMATS[22]

USER_LIST = """
    select username, full_name, user_type, role_name, created_at, last_login_at, days_since_login,
           items_owned, items_modified_recent, disabled
    from v_users where org_id = %(org)s
"""

TOP_USERS = """
    select * from (
        select coalesce({group_col}, '(not visible)') as {group_col},
               row_number() over (partition by {group_col}
                                  order by items_modified_recent desc, items_owned desc,
                                           last_login_at desc nulls last, username) as rn,
               username, full_name, {other_col}, items_modified_recent, items_owned, last_login_at
        from v_users where org_id = %(org)s
    ) ranked
    where rn <= %(top)s
    order by {group_col}, rn
"""

GROUP_LIST = """
    select title, group_id, member_count, item_count, owner, created_at, modified_at, days_since_modified
    from v_groups where org_id = %(org)s
"""

ITEM_LIST = """
    select title, item_id, type, owner_username, access, created_at, modified_at, days_since_modified,
           views, round(size_bytes / 1048576.0, 2) as size_mb, completeness_score, content_status,
           share_count, dependency_count, referenced_count, usage_30d, is_empty
    from v_items where org_id = %(org)s
"""

SHARE = "round(100.0 * count(*) / sum(count(*)) over (), 1) as pct"

LABELS = {
    "username": "Username", "full_name": "Full name", "user_type": "User type",
    "role": "Role", "role_name": "Role", "users": "Users", "pct": "% of users",
    "activity_status": "Activity status", "rn": "Rank",
    "created_at": "Created", "last_login_at": "Last login", "days_since_login": "Days since login",
    "items_owned": "Items owned", "items_modified_recent": "Items modified (last 90 days)",
    "disabled": "Disabled", "title": "Name", "group_id": "ID", "member_count": "Members",
    "item_count": "Nb Items", "owner": "Owner", "modified_at": "Last modified",
    "days_since_modified": "Days since modified",
    "item_id": "Item ID", "type": "Type", "owner_username": "Owner", "access": "Access",
    "views": "Views", "size_mb": "Size (MB)", "completeness_score": "Metadata score",
    "content_status": "Status", "share_count": "Shared with groups", "dependency_count": "Dependencies",
    "referenced_count": "Referenced by", "usage_30d": "Usage (30 days)", "is_empty": "Empty",
    "items": "Items", "type_pct": "% of items", "check_name": "Check", "error": "Error",
    "checked_at": "Checked",
}


def frame(db, sql, **params):
    cursor = db.execute(sql, {"org": params.pop("org"), **params})
    columns = [column.name for column in cursor.description]
    return pd.DataFrame(cursor.fetchall(), columns=columns)


def build(db, org_id):
    org = db.execute(
        """select name, url, arcgis_id, last_fetched_at, fetched_as_admin, user_details_visible
           from organizations where org_id = %s""",
        (org_id,),
    ).fetchone()
    if not org:
        raise SystemExit("Organization not found.")
    name, url, arcgis_id, fetched_at, as_admin, details_visible = org

    counts = frame(db, """
        select count(*) as total_users,
               count(*) filter (where activity_status = 'active') as active,
               count(*) filter (where activity_status = 'inactive') as inactive,
               count(*) filter (where activity_status = 'never_logged_in') as never_logged_in,
               count(*) filter (where activity_status = 'unknown') as unknown,
               count(*) filter (where disabled) as disabled,
               (select count(*) from v_groups where org_id = %(org)s) as groups,
               (select count(*) from group_members where org_id = %(org)s) as memberships
        from v_users where org_id = %(org)s""", org=org_id).iloc[0]

    summary = pd.DataFrame([
        ("Organization", name),
        ("Organization ID", arcgis_id),
        ("URL", url),
        ("Data fetched at", fetched_at),
        ("Fetched as admin", "Yes" if as_admin else "No"),
        ("User details visible", "Yes" if details_visible else "No"),
        ("Inactive after (days without login)", 90),
        ("'Recent' items window (days)", 90),
        ("Total users", int(counts["total_users"])),
        ("Active users", int(counts["active"])),
        ("Inactive users", int(counts["inactive"])),
        ("Never logged in", int(counts["never_logged_in"])),
        ("Activity unknown", int(counts["unknown"])),
        ("Disabled accounts", int(counts["disabled"])),
        ("Groups", int(counts["groups"])),
        ("Group memberships", int(counts["memberships"])),
        ("Note", "Fetched with admin rights." if as_admin
         else "Fetched without admin rights: only visible groups and items are counted (lower bounds)."),
    ], columns=["Item", "Value"])

    grid_source = frame(db, """
        select coalesce(role_name, '(not visible)') as role, coalesce(user_type, '(not visible)') as user_type,
               count(*) as users
        from v_users where org_id = %(org)s group by 1, 2""", org=org_id)
    if grid_source.empty:
        grid = pd.DataFrame(columns=["role"])
    else:
        grid = pd.pivot_table(grid_source, index="role", columns="user_type", values="users", aggfunc="sum",
                              fill_value=0, margins=True, margins_name="Total").reset_index()
        grid.columns.name = None

    def groups(tail):
        return frame(db, GROUP_LIST + tail, org=org_id)

    def items(tail):
        return frame(db, ITEM_LIST + tail, org=org_id, rank=RANK_LIMIT)

    item_counts = frame(db, """
        select count(*) as total,
               count(distinct type) as types,
               count(*) filter (where deprecated) as deprecated,
               count(*) filter (where never_modified) as never_modified,
               count(*) filter (where owner_disabled) as owner_disabled,
               count(*) filter (where is_empty) as empty,
               count(*) filter (where depends_on_empty) as depends_on_empty,
               count(*) filter (where usage_30d = 0) as no_usage,
               count(size_bytes) as sized,
               count(dependency_count) as dependencies_read,
               count(*) filter (where type in ('Web Map', 'Feature Service', 'Feature Collection', 'CSV', 'Map Service')) as empty_checkable,
               count(is_empty) as empty_read,
               count(usage_30d) as usage_read
        from v_items where org_id = %(org)s""", org=org_id).iloc[0]
    item_summary = pd.DataFrame([
        ("Items", int(item_counts["total"])),
        ("Item types", int(item_counts["types"])),
        ("Deprecated", int(item_counts["deprecated"])),
        ("Never modified since creation", int(item_counts["never_modified"])),
        ("Owned by disabled accounts", int(item_counts["owner_disabled"])),
        ("Empty items", int(item_counts["empty"])),
        ("Items depending on empty items", int(item_counts["depends_on_empty"])),
        ("No usage in the last 30 days", int(item_counts["no_usage"])),
        ("Size known", f"{int(item_counts['sized'])} of {int(item_counts['total'])}"),
        ("Dependencies read", f"{int(item_counts['dependencies_read'])} of {int(item_counts['total'])}"),
        ("Empty check done", f"{int(item_counts['empty_read'])} of {int(item_counts['empty_checkable'])}"),
        ("Usage read", f"{int(item_counts['usage_read'])} of {int(item_counts['total'])}"),
        ("Note", "Per-item reads are cached and spread over collections; counts cover the items read so far."),
    ], columns=["Item", "Value"])

    return {
        "Summary": summary,
        "Users by type": frame(db, f"""
            select coalesce(user_type, '(not visible)') as user_type, count(*) as users, {SHARE}
            from v_users where org_id = %(org)s group by 1 order by users desc""", org=org_id),
        "Users by role": frame(db, f"""
            select coalesce(role_name, '(not visible)') as role_name, count(*) as users, {SHARE}
            from v_users where org_id = %(org)s group by 1 order by users desc""", org=org_id),
        "Role x type": grid,
        "Activity status": frame(db, f"""
            select activity_status, count(*) as users, {SHARE}
            from v_users where org_id = %(org)s group by 1
            order by case activity_status when 'active' then 1 when 'inactive' then 2
                                          when 'never_logged_in' then 3 else 4 end""", org=org_id),
        "Inactive users": frame(db, USER_LIST + " and activity_status = 'inactive' order by days_since_login desc",
                                org=org_id),
        "Never logged in": frame(db, USER_LIST + " and activity_status = 'never_logged_in' order by created_at",
                                 org=org_id),
        "Disabled accounts": frame(db, USER_LIST + " and disabled order by username", org=org_id),
        f"Top {TOP_N} per type": frame(db, TOP_USERS.format(group_col="user_type", other_col="role_name"),
                                       org=org_id, top=TOP_N),
        f"Top {TOP_N} per role": frame(db, TOP_USERS.format(group_col="role_name", other_col="user_type"),
                                       org=org_id, top=TOP_N),
        "Groups by members": groups(" order by member_count desc, title"),
        "Groups by items": groups(" order by item_count desc, title"),
        "Empty groups": groups(" and item_count = 0 order by member_count desc, title"),
        "Single-member groups": groups(" and member_count = 1 order by item_count desc, title"),
        "Stale groups": groups(f" and days_since_modified > {STALE_DAYS} order by days_since_modified desc, title"),
        "Item summary": item_summary,
        "Item types": frame(db, """
            select type, count(*) as items, round(100.0 * count(*) / sum(count(*)) over (), 1) as type_pct
            from v_items where org_id = %(org)s group by 1 order by items desc, type""", org=org_id),
        "Most viewed items": items(" order by views desc nulls last, title limit %(rank)s"),
        "Not modified longest": items(" order by modified_at asc nulls last, title limit %(rank)s"),
        "Largest items": items(" and size_bytes is not null order by size_bytes desc, title limit %(rank)s"),
        "Never modified": items(" and never_modified order by created_at, title"),
        "Deprecated items": items(" and deprecated order by modified_at, title"),
        "Highest metadata scores": items(" and completeness_score is not null order by completeness_score desc, title limit %(rank)s"),
        "Lowest metadata scores": items(" and completeness_score is not null order by completeness_score asc, title limit %(rank)s"),
        "Owned by disabled accounts": items(" and owner_disabled order by owner_username, title"),
        "Most dependencies": items(" and dependency_count > 0 order by dependency_count desc, title limit %(rank)s"),
        "Most referenced": items(" and referenced_count > 0 order by referenced_count desc, title limit %(rank)s"),
        "Empty items": items(" and is_empty order by type, title"),
        "Depending on empty items": items(" and depends_on_empty order by type, title"),
        "Most used items": items(" and usage_30d > 0 order by usage_30d desc, title limit %(rank)s"),
        "Least used items": items(" and usage_30d > 0 order by usage_30d asc, title limit %(rank)s"),
        "No usage": items(" and usage_30d = 0 order by views desc nulls last, title"),
        "Most shared with groups": items(" and share_count > 0 order by share_count desc, title limit %(rank)s"),
        "Items not read": frame(db, """
            select c.check_name, i.title, c.item_id, i.type, c.error, c.checked_at
            from item_checks c join items i on i.org_id = c.org_id and i.item_id = c.item_id
            where c.org_id = %(org)s and not c.ok
            order by c.check_name, i.title""", org=org_id),
    }


def plain(value):
    if value is None or (isinstance(value, float) and pd.isna(value)):
        return None
    if isinstance(value, float) and value.is_integer():
        return int(value)
    if value is pd.NaT:
        return None
    if isinstance(value, (pd.Timestamp, datetime, date)):
        return value.isoformat()
    if isinstance(value, Decimal):
        return float(value)
    if hasattr(value, "item"):
        return value.item()
    return value


def as_json(sheets, limit):
    out = []
    for name, df in sheets.items():
        rows = [[plain(value) for value in row] for row in df.head(limit).itertuples(index=False, name=None)]
        out.append({
            "name": name,
            "columns": [LABELS.get(str(column), str(column)) for column in df.columns],
            "rows": rows,
            "total": len(df),
        })
    return {"sheets": out}


def local_naive(value):
    if value is None or pd.isna(value):
        return None
    return pd.Timestamp(value).to_pydatetime().astimezone().replace(tzinfo=None)


def excel_ready(df):
    out = df.copy()
    for column in out.columns:
        if isinstance(out[column].dtype, pd.DatetimeTZDtype):
            out[column] = pd.to_datetime(out[column].map(local_naive))
        elif out[column].dtype == object:
            out[column] = out[column].map(lambda v: local_naive(v) if isinstance(v, datetime) else v)
    return out.rename(columns=LABELS)


def as_xlsx(sheets):
    buffer = io.BytesIO()
    with pd.ExcelWriter(buffer, engine="openpyxl") as writer:
        for name, df in sheets.items():
            ready = excel_ready(df)
            ready.to_excel(writer, sheet_name=name[:31], index=False)
            sheet = writer.sheets[name[:31]]
            for index, column in enumerate(ready.columns, start=1):
                if pd.api.types.is_datetime64_any_dtype(ready[column]):
                    for (cell,) in sheet.iter_rows(min_row=2, min_col=index, max_col=index):
                        cell.number_format = SHORT_DATE
            sheet.freeze_panes = "A2"
            sheet.auto_filter.ref = sheet.dimensions
            for index, cells in enumerate(sheet.iter_cols(), start=1):
                longest = max((10 if isinstance(c.value, datetime) else len(str(c.value))
                               for c in cells if c.value is not None), default=0)
                sheet.column_dimensions[get_column_letter(index)].width = min(longest + 2, 60)
        for row in writer.sheets["Summary"].iter_rows(min_col=2, max_col=2):
            for cell in row:
                if isinstance(cell.value, datetime):
                    cell.number_format = SHORT_DATETIME
    return buffer.getvalue()


def main():
    org_id, kind = sys.argv[1], sys.argv[2]
    with psycopg.connect(os.environ["DATABASE_URL"]) as db:
        sheets = build(db, org_id)
    if kind == "xlsx":
        sys.stdout.buffer.write(as_xlsx(sheets))
    else:
        limit = int(sys.argv[3]) if len(sys.argv) > 3 else 500
        sys.stdout.write(json.dumps(as_json(sheets, limit)))


if __name__ == "__main__":
    main()
