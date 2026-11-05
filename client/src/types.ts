export type Health = {
  api: 'ok'
  database: 'ok' | 'starting' | 'down'
  identity: 'ok' | 'starting' | 'down'
  identityUrl: string
}

export type ActivityRow = {
  id: string
  actor: string
  action: string
  target: string | null
  occurred_at: string
}

export type OverviewResponse = {
  counts: {
    users: number
    groups: number
    content: number
    connections: number
    jobs: number
  }
  services: {
    database: 'ok' | 'down'
    identity: 'ok' | 'starting' | 'down'
  }
  activity: ActivityRow[]
}

export type ChangeRow = {
  id: string
  entity_type: string
  entity_id: string
  action: 'created' | 'updated' | 'deleted'
  field_name: string | null
  old_value: unknown
  new_value: unknown
  label: string | null
  detected_at: string
}

export type OrgSummary = {
  organization: {
    org_id: string
    name: string
    url: string
    region: string | null
    culture: string | null
    portal_version: string | null
    is_enterprise: boolean | null
    last_fetched_at: string | null
  } | null
  lastRun?: {
    status: 'running' | 'succeeded' | 'failed'
    started_at: string
    finished_at: string | null
    signed_in_username: string | null
    signed_in_role: string | null
    summary: { full_view?: boolean; changes?: number; gaps?: number; baseline?: boolean } | null
    error_details: { section: string; error: string }[] | null
  } | null
  members?: number | null
  subscription?: { type: string | null; state: string | null; expires_at: string | null; max_members: number | null } | null
  credits?: number | null
  storage?: { used_bytes: number | null; quota_bytes: number | null } | null
  totals?: { groups: number; items: number; views: number; hosted_services: number; invitations: number }
  userTypes?: { name: string; assigned_count: number | null; purchased_seats: number | null }[]
  roles?: { name: string; member_count: number | null }[]
  licenses?: { license_name: string; license_kind: string; assigned_count: number | null }[]
  changes?: ChangeRow[]
  health?: {
    users: number
    inactive: number
    never_logged_in: number
    disabled: number
    inactive_days: number | null
    empty_groups: number
    single_member_groups: number
    stale_groups: number
    stale_days: number
  }
  itemHealth?: {
    items: number
    deprecated: number
    never_modified: number
    owner_disabled: number
    empty: number
    depends_on_empty: number
    no_usage: number
    dependencies_read: number
    empty_read: number
    empty_checkable: number
    usage_read: number
  }
}

export type UserRow = {
  id: string
  org_id: string
  username: string
  full_name: string
  user_type: string | null
  role_name: string | null
  disabled: boolean
  last_login_at: string | null
  activity_status: 'active' | 'inactive' | 'never_logged_in' | 'unknown'
  items_owned: number
  portal_url: string
}

export type GroupRow = {
  id: string
  org_id: string
  group_id: string
  title: string
  access: string | null
  owner_username: string | null
  member_count: number
  item_count: number
  modified_at: string | null
  days_since_modified: number | null
  portal_url: string
}

export type ReportSheet = {
  name: string
  columns: string[]
  rows: unknown[][]
  total: number
}

export type ContentRow = {
  id: string
  org_id: string
  item_id: string
  title: string
  type: string
  owner_username: string | null
  access: string | null
  modified_at: string | null
  views: number | null
  size_bytes: number | null
  completeness_score: number | null
  usage_30d: number | null
  share_count: number
  dependency_count: number | null
  referenced_count: number
  is_empty: boolean | null
  deprecated: boolean
  owner_disabled: boolean
  portal_url: string
}

export type DependencyItem = {
  id: string
  title: string | null
  type: string | null
  owner_username: string | null
  is_empty: boolean | null
  in_org: boolean
}

export type ItemDependencies = {
  item: { item_id: string; title: string; type: string; owner_username: string | null; is_empty: boolean | null }
  check: { ok: boolean; error: string | null; checked_at: string } | null
  uses: DependencyItem[]
  usedBy: DependencyItem[]
}

export type ConnectionRow = {
  id: string
  name: string
  kind: string
  portal_url: string
  username: string
  status: string
  created_at: string
}

export type JobRow = {
  id: string
  name: string
  status: string
  created_at: string
}

export type ListResponse<T> = {
  items: T[]
}
