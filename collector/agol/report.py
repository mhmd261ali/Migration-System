
import json
from collections.abc import Mapping
from datetime import datetime, timezone
from pathlib import Path

from agol import content, groups, members, organization, usage
from agol.connect import connect


# Run every section and return the summary. Item rows are not kept.
def collect():
    gis = connect()
    me = gis.users.me
    items = content.all_items(gis)

    return {
        "connection": {"url": gis.url, "username": me.username, "role": me.role},
        "organization": {
            "profile": organization.profile(gis),
            "security": organization.security(gis),
            "maps": organization.maps(gis),
            "subscription": organization.subscription(gis),
            "settings": organization.settings(gis),
        },
        "members": {
            "counts": members.counts(gis),
            "roles": members.roles(gis),
            "invitations": members.invitations(gis),
        },
        "groups": groups.all_groups(gis),
        "content": {
            "count": len(items),
            "summary": content.summary(items),
            "services": content.services(items),
        },
        "usage": {
            "credits": usage.credits(gis),
            "licenses": usage.licenses(gis),
            "storage": usage.storage(gis),
        },
    }


# Write agol_report.md and a short agol_report.json.
def main():
    print("Collecting the organization report...", flush=True)
    report = _plain(collect())
    markdown = Path("agol_report.md")
    data = Path("agol_report.json")
    markdown.write_text(to_markdown(report), encoding="utf-8")
    data.write_text(json.dumps(report, indent=2), encoding="utf-8")
    print(markdown.resolve())


# The readable report. Counts and short tables, not the item list.
def to_markdown(report):
    connection = report["connection"]
    profile = report["organization"]["profile"]
    security = report["organization"]["security"]
    subscription = report["organization"]["subscription"]
    settings = report["organization"]["settings"]
    maps = report["organization"]["maps"]
    member_counts = report["members"]["counts"]
    roles = report["members"]["roles"]
    group_report = report["groups"]
    summary = report["content"]["summary"]
    services = report["content"]["services"]
    credits = report["usage"]["credits"]
    licenses = report["usage"]["licenses"]
    storage = report["usage"]["storage"]

    lines = [
        f"# {profile.get('name')}",
        "",
        f"Signed in as **{connection.get('username')}** ({connection.get('role')}).",
        "",
        connection.get("url") or "",
        "",
        (
            f"{profile.get('portal_name')} {profile.get('portal_version')}"
            f" · {subscription.get('type')} · {subscription.get('state')}"
        ),
        f"Created {_when(profile.get('created'))}. Last updated {_when(profile.get('modified'))}.",
        f"Organization id: {profile.get('id')}. Access: {profile.get('access') or 'not set'}.",
        f"Region: {profile.get('region') or 'not set'}. Units: {profile.get('units') or 'not set'}. Portal mode: {profile.get('portal_mode') or 'not set'}.",
        f"Read only: {_yes(profile.get('read_only'))}.",
        *([f"Culture: {profile.get('culture')}."] if profile.get("culture") else []),
        *([_plain_text(profile.get("description"))] if _plain_text(profile.get("description")) else []),
        f"Site license expires {_when(subscription.get('expiration'))}. Subscription id: {subscription.get('id')}.",
        f"Storage region: {subscription.get('storage_region') or 'not set'}. Maximum members: {_num(subscription.get('max_members'))}.",
        "",
        *_security(security),
        "",
        *_maps(maps),
        "",
        *_settings(settings),
        "",
        "## Members",
        "",
        f"**{_num(member_counts.get('total'))}** members.",
        "",
    ]
    lines += _table(
        ["User type", "Assigned", "Seats", "Open"],
        [
            [row.get("user_type"), _num(row.get("assigned")), _num(row.get("max_seats")), _num(row.get("remaining"))]
            for row in member_counts.get("seats") or []
        ],
    )
    lines += ["", "### Roles", ""]
    role_rows = roles.get("counts") if isinstance(roles.get("counts"), list) else []
    lines += _table(
        ["Role", "Members"],
        [[row.get("role"), _num(row.get("count"))] for row in role_rows],
    )
    if _blocked(report["members"].get("invitations")):
        lines += ["", "Pending invitations are not available for this role."]

    lines += ["", "## Groups", "", f"**{_num(group_report.get('count'))}** groups.", ""]
    access = group_report.get("by_access") or {}
    lines += _table(
        ["Sharing", "Groups"],
        [[key, _num(count)] for key, count in access.items()],
    )

    lines += ["", "## Content", ""]
    lines.append(f"**{_num(summary.get('total'))}** items.")
    lines.append("")
    lines += _table(
        ["Sharing", "Items"],
        [[key, _num(count)] for key, count in (summary.get("by_access") or {}).items()],
    )
    if summary.get("views") is not None:
        lines += [
            "",
            f"Views: {_num(summary.get('views'))} total, {summary.get('average_views')} average.",
            f"Average completeness: {summary.get('average_completeness')}.",
        ]
    lines += ["", "Missing item information:", ""]
    lines += _table(
        ["Field", "Items missing it"],
        [
            ["Description", _num(summary.get("missing_description"))],
            ["Summary", _num(summary.get("missing_summary"))],
            ["Tags", _num(summary.get("missing_tags"))],
            ["Thumbnail", _num(summary.get("missing_thumbnail"))],
        ],
    )
    type_rows, other_count, other_types = _top_types(summary.get("by_type") or {})
    lines += ["", "### Item types", ""]
    lines += _table(["Type", "Items"], type_rows)
    if other_types:
        lines += ["", f"{_num(other_count)} items are spread across {other_types} other types."]

    lines += [
        "",
        "## Services",
        "",
        f"Hosted: **{_num(services.get('hosted'))}**. Referenced: **{_num(services.get('referenced'))}**.",
        f"Tiled map services: {_num(services.get('tiled_map_services'))}.",
        "",
    ]
    lines += _table(
        ["Service", "Items"],
        [[name, _num(count)] for name, count in (services.get("by_type") or {}).items()],
    )

    lines += ["", "## Credits and storage", ""]
    if isinstance(credits, dict):
        lines += [
            f"Balance: **{_num(credits.get('balance'))}** credits.",
            f"Budgeting is {'on' if credits.get('budgeting_enabled') else 'off'}. Default member cap: {_num(credits.get('default_limit'))}.",
        ]
        if credits.get("sum_of_default_caps") is not None:
            lines.append(
                f"If every member is on that cap, the caps add up to {_num(credits.get('sum_of_default_caps'))}."
            )
        usage = credits.get("used_last_30_days")
        if isinstance(usage, dict):
            lines += ["", "Spent in the last 30 days:", ""]
            lines += _table(["Category", "Credits"], _credit_rows(usage))
    elif _blocked(credits):
        lines.append("Credits are not available for this role.")
    if isinstance(storage, dict):
        percent = storage.get("percent_used")
        percent_text = f" ({percent}%)" if percent is not None else ""
        lines += [
            "",
            f"Storage: **{storage.get('used_tb')} TB** of {storage.get('quota_tb')} TB{percent_text}.",
        ]
        feature = storage.get("feature_data_store")
        if isinstance(feature, dict) and feature.get("percent") is not None:
            lines.append(f"Feature data store: {feature.get('percent')}% full.")

    app_rows = licenses.get("apps") if isinstance(licenses, dict) else None
    if isinstance(app_rows, list) and app_rows:
        lines += ["", "### Add-on apps", ""]
        lines += _table(
            ["App", "Members"],
            [[row.get("secondaryKey") or row.get("key"), _num(row.get("count"))] for row in app_rows],
        )
    blocked = []
    if isinstance(licenses, dict):
        if _blocked(licenses.get("user_types")):
            blocked.append("user-type list")
        if _blocked(licenses.get("add_ons")):
            blocked.append("add-on inventory")
    if _blocked(security.get("password_policy")):
        blocked.append("password policy")
    if _blocked(security.get("identity_providers")):
        blocked.append("identity providers")
    if _blocked(settings.get("collaborations")):
        blocked.append("collaborations")
    if blocked:
        lines += ["", f"Not available for this role: {', '.join(blocked)}."]

    lines.append("")
    return "\n".join(lines)


def _plain_text(value):
    if not value:
        return ""
    return str(value).replace("<br>", "").replace("<br/>", "").strip()


def _yes(value):
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return "not set"


# Sign-in, sharing, API keys, and certificates.
def _security(security):
    lines = ["## Security", ""]
    lines.append(f"HTTPS required: {_yes(security.get('https_required'))}.")
    lines.append(f"MFA enabled: {_yes(security.get('mfa_enabled'))}.")
    methods = [
        label
        for label, key in (
            ("ArcGIS", "arcgis_sign_in"),
            ("enterprise", "enterprise_sign_in"),
            ("OIDC", "oidc_sign_in"),
            ("social", "social_sign_in"),
            ("OAuth", "oauth"),
        )
        if security.get(key)
    ]
    if methods:
        lines.append("Sign-in: " + ", ".join(methods) + ".")
    timeout = security.get("inactivity_timeout_minutes")
    if timeout:
        lines.append(f"Inactivity timeout: {timeout} minutes.")
    elif timeout == 0:
        lines.append("Inactivity timeout: none.")
    lines.append(f"Members can share publicly: {_yes(security.get('can_share_public'))}.")
    lines.append(f"Members can search public content: {_yes(security.get('can_search_public'))}.")
    if security.get("anonymous_access") is not None:
        lines.append(f"Anonymous access: {_yes(security.get('anonymous_access'))}.")
    origins = security.get("allowed_origins")
    if isinstance(origins, list):
        lines.append("Allowed origins: " + (", ".join(origins) if origins else "none") + ".")
    if isinstance(security.get("api_key_count"), int):
        lines.append(f"API keys: {security.get('api_key_count')}.")
    certificates = security.get("certificates")
    if isinstance(certificates, list):
        lines.append(f"Certificates: {len(certificates)}.")
    providers = security.get("social_providers")
    if isinstance(providers, dict) and not providers and not _blocked(providers):
        lines.append("Social providers: none.")
    return lines


# Basemap, 3D, and where hosted services are served.
def _maps(maps):
    lines = ["## Maps", ""]
    lines.append(f"Default basemap: {maps.get('default_basemap') or 'none'}.")
    lines.append(f"Default vector basemap: {maps.get('default_vector_basemap') or 'none'}.")
    lines.append(f"Hosted services: {_yes(maps.get('supports_hosted_services'))}.")
    lines.append(f"Use vector basemaps: {_yes(maps.get('use_vector_basemaps'))}.")
    lines.append(f"Use 3D basemaps: {_yes(maps.get('use_3d_basemaps'))}.")
    lines.append(f"3D tiles: {_yes(maps.get('supports_3d_tiles'))}.")
    extent = maps.get("default_extent")
    if isinstance(extent, dict) and isinstance(extent.get("spatialReference"), dict):
        lines.append(f"Default extent spatial reference: {extent['spatialReference'].get('wkid')}.")
    hosts = _hosts(maps.get("service_urls"))
    if hosts:
        lines.append("Service hosts: " + ", ".join(hosts) + ".")
    return lines


def _hosts(value):
    urls = value.get("urls") if isinstance(value, dict) else None
    if not isinstance(urls, dict):
        return []
    hosts = []
    for info in urls.values():
        if not isinstance(info, dict):
            continue
        for name in info.get("https") or []:
            if name not in hosts:
                hosts.append(str(name))
    return hosts


# Organization settings: AI, helper services, featured groups, categories.
def _settings(settings):
    lines = ["## Settings", ""]
    lines.append(f"AI assistants: {'on' if settings.get('ai_assistants_enabled') else 'off'}.")
    lines.append(f"AI services: {'on' if settings.get('ai_services_enabled') else 'off'}.")

    helpers = settings.get("helper_services") or []
    if helpers:
        lines.append("Helper services: " + ", ".join(str(name) for name in helpers) + ".")

    featured = settings.get("featured_groups") or []
    titles = [group.get("title") for group in featured if isinstance(group, dict) and group.get("title")]
    if titles:
        lines.append("Featured groups: " + ", ".join(titles) + ".")

    schema = settings.get("category_schema")
    if isinstance(schema, dict):
        categories = schema.get("categorySchema") or []
        lines.append("Category schema: " + ("none" if not categories else str(len(categories)) + " categories") + ".")

    credentials = settings.get("developer_credentials")
    if isinstance(credentials, list):
        lines.append(f"Developer credentials: {len(credentials)}.")
    return lines


def _top_types(by_type, limit=12):
    ranked = sorted(by_type.items(), key=lambda item: item[1], reverse=True)
    top = [[name, _num(count)] for name, count in ranked[:limit]]
    rest = ranked[limit:]
    return top, sum(count for _, count in rest), len(rest)


def _credit_rows(usage):
    rows = [(name, amount) for name, amount in usage.items() if amount]
    rows.sort(key=lambda item: item[1], reverse=True)
    total = round(sum(amount for _, amount in rows), 1)
    shown = [[name, _num(round(amount, 1))] for name, amount in rows]
    shown.append(["Total", _num(total)])
    return shown


def _table(headers, rows):
    lines = [
        "| " + " | ".join(headers) + " |",
        "| " + " | ".join("---" for _ in headers) + " |",
    ]
    for row in rows:
        lines.append("| " + " | ".join(_cell(value) for value in row) + " |")
    return lines


def _cell(value):
    return str(value if value is not None else "").replace("|", "/")


def _num(value):
    if isinstance(value, bool) or value is None:
        return ""
    if isinstance(value, float):
        return f"{value:,.1f}"
    if isinstance(value, int):
        return f"{value:,}"
    return str(value)


def _when(value):
    if not value:
        return "unknown"
    try:
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).strftime("%d %b %Y")
    except (TypeError, ValueError, OSError):
        return str(value)


def _blocked(value):
    if isinstance(value, str) and ("403" in value or "permission" in value.lower()):
        return True
    return isinstance(value, dict) and "error" in value


# Turn ArcGIS and numpy values into plain JSON.
def _plain(value):
    if value is None or isinstance(value, (str, int, float, bool)):
        return value
    if isinstance(value, Mapping):
        return {str(key): _plain(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [_plain(item) for item in value]
    if type(value).__module__ == "numpy":
        try:
            return _plain(value.item())
        except Exception:
            return str(value)
    return str(value)


if __name__ == "__main__":
    main()
