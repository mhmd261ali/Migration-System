"""Organization profile, security, maps, subscription, and settings."""

from collections.abc import Mapping

from agol.connect import safely


# Organization name, portal, and dates.
def profile(gis):
    org = gis.properties
    return {
        "name": org.get("name"),
        "id": org.get("id"),
        "url": gis.url,
        "description": org.get("description"),
        "region": org.get("region"),
        "culture": org.get("culture"),
        "units": org.get("units"),
        "access": org.get("access"),
        "created": org.get("created"),
        "modified": org.get("modified"),
        "portal_name": org.get("portalName"),
        "is_enterprise": org.get("isPortal"),
        "portal_mode": org.get("portalMode"),
        "portal_version": org.get("currentVersion"),
        "read_only": org.get("isReadOnly"),
    }


# Sign-in options, sharing rules, and admin security settings.
def security(gis):
    org = gis.properties
    return {
        "https_required": org.get("allSSL"),
        "arcgis_sign_in": org.get("canSignInArcGIS"),
        "enterprise_sign_in": org.get("canSignInIDP"),
        "oidc_sign_in": org.get("canSignInOIDC"),
        "social_sign_in": org.get("canSignInSocial"),
        "oauth": org.get("supportsOAuth"),
        "mfa_enabled": org.get("mfaEnabled"),
        "inactivity_timeout_minutes": org.get("inactivityTimeout"),
        "anonymous_access": org.get("anonymousAccess"),
        "can_share_public": org.get("canSharePublic"),
        "can_search_public": org.get("canSearchPublic"),
        "password_policy": safely(lambda: gis.admin.password_policy.policy),
        "allowed_origins": safely(lambda: gis.admin.ux.security_settings.allowed_origins),
        "identity_providers": safely(lambda: gis.admin.idp.properties),
        "social_providers": safely(lambda: gis.admin.social_providers.properties),
        "api_key_count": safely(lambda: len(list(gis.api_keys.keys))),
        "certificates": safely(lambda: gis.admin.certificates.certificates),
    }


# Basemap title, when the portal returns a basemap object.
def _title(value):
    if isinstance(value, Mapping):
        return value.get("title")
    return None


# Default basemap, map extent, and hosted service urls.
def maps(gis):
    org = gis.properties
    return {
        "default_basemap": _title(org.get("defaultBasemap")),
        "default_vector_basemap": _title(org.get("defaultVectorBasemap")),
        "default_extent": org.get("defaultExtent"),
        "supports_hosted_services": org.get("supportsHostedServices"),
        "use_vector_basemaps": org.get("useVectorBasemaps"),
        "use_3d_basemaps": org.get("use3dBasemaps"),
        "supports_3d_tiles": org.get("supports3DTilesServices"),
        "hosted_servers": safely(lambda: gis.admin.servers.properties),
        "service_urls": safely(lambda: gis.admin.urls),
    }


# License type, expiration, and purchased seats.
def subscription(gis):
    sub = gis.subscription_information or {}
    return {
        "id": sub.get("id"),
        "type": sub.get("type"),
        "state": sub.get("state"),
        "expiration": sub.get("expDate"),
        "storage_region": sub.get("storageRegion"),
        "max_members": sub.get("maxUsers"),
        "user_license_types": sub.get("userLicenseTypes"),
    }


# Homepage, helper services, and categories.
def settings(gis):
    org_settings = gis.org_settings or {}
    helpers = org_settings.get("helperServices") or {}
    return {
        "ai_assistants_enabled": org_settings.get("aiAssistantsEnabled"),
        "ai_services_enabled": org_settings.get("aiServicesEnabled"),
        "featured_groups": org_settings.get("featuredGroups"),
        "helper_services": list(helpers) if helpers else [],
        "category_schema": safely(lambda: gis.admin.category_schema.schema),
        "developer_credentials": safely(lambda: _credentials(gis)),
        "collaborations": safely(lambda: gis.admin.collaborations.list()),
    }


# Developer credentials this account can see.
def _credentials(gis):
    rows = []
    for credential in gis.admin.developer_credentials.list():
        item = credential.item
        rows.append({"title": item.title, "id": item.id, "owner": item.owner})
    return rows
