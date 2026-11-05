-- ArcGIS Online relational model (org-scoped) plus change-history audit tables.
-- Linked to console connections via organizations.connection_id / organizations.url.

create table if not exists organizations (
  org_id uuid primary key default gen_random_uuid(),
  connection_id uuid unique references connections (id) on delete set null,
  name text not null,
  url text not null unique,
  description text,
  region text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_fetched_at timestamptz
);

create table if not exists organization_settings (
  org_id uuid not null references organizations (org_id) on delete cascade,
  setting_name text not null,
  setting_value jsonb,
  fetched_at timestamptz,
  primary key (org_id, setting_name)
);

create table if not exists subscriptions (
  org_id uuid primary key references organizations (org_id) on delete cascade,
  subscription_id text,
  type text,
  state text,
  expires_at timestamptz,
  max_members integer,
  storage_region text
);

create table if not exists organization_activity (
  activity_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  event_at timestamptz not null,
  event_type text not null,
  actor_username text,
  detail jsonb
);

create index if not exists organization_activity_org_event_idx
  on organization_activity (org_id, event_at desc);

create table if not exists report_runs (
  run_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  status text not null default 'running',
  items_processed integer not null default 0,
  errors integer not null default 0
);

create index if not exists report_runs_org_started_idx
  on report_runs (org_id, started_at desc);

create table if not exists roles (
  org_id uuid not null references organizations (org_id) on delete cascade,
  role_id text not null,
  name text not null,
  is_custom boolean not null default false,
  privilege_count integer,
  primary key (org_id, role_id)
);

create table if not exists user_types (
  org_id uuid not null references organizations (org_id) on delete cascade,
  user_type_id text not null,
  name text not null,
  purchased_seats integer,
  primary key (org_id, user_type_id)
);

create table if not exists users (
  org_id uuid not null references organizations (org_id) on delete cascade,
  username text not null,
  full_name text,
  email text,
  user_type_id text,
  role_id text,
  created_at timestamptz,
  last_login_at timestamptz,
  disabled boolean not null default false,
  fetched_at timestamptz,
  primary key (org_id, username),
  foreign key (org_id, role_id) references roles (org_id, role_id),
  foreign key (org_id, user_type_id) references user_types (org_id, user_type_id)
);

create table if not exists invitations (
  org_id uuid not null references organizations (org_id) on delete cascade,
  invitation_id text not null,
  invited_email text,
  invited_at timestamptz,
  status text,
  primary key (org_id, invitation_id)
);

create table if not exists groups (
  org_id uuid not null references organizations (org_id) on delete cascade,
  group_id text not null,
  title text not null,
  owner_username text,
  access text,
  created_at timestamptz,
  modified_at timestamptz,
  primary key (org_id, group_id),
  foreign key (org_id, owner_username) references users (org_id, username)
);

create table if not exists group_members (
  org_id uuid not null,
  group_id text not null,
  username text not null,
  member_role text,
  joined_at timestamptz,
  primary key (org_id, group_id, username),
  foreign key (org_id, group_id) references groups (org_id, group_id) on delete cascade,
  foreign key (org_id, username) references users (org_id, username) on delete cascade
);

create table if not exists items (
  org_id uuid not null references organizations (org_id) on delete cascade,
  item_id text not null,
  title text not null,
  type text not null,
  owner_username text,
  access text,
  created_at timestamptz,
  modified_at timestamptz,
  views integer,
  size_bytes bigint,
  completeness_score numeric,
  content_status text,
  description text,
  snippet text,
  tags text[],
  thumbnail_url text,
  primary key (org_id, item_id),
  foreign key (org_id, owner_username) references users (org_id, username)
);

create table if not exists item_group_shares (
  org_id uuid not null,
  item_id text not null,
  group_id text not null,
  observed_at timestamptz,
  primary key (org_id, item_id, group_id),
  foreign key (org_id, item_id) references items (org_id, item_id) on delete cascade,
  foreign key (org_id, group_id) references groups (org_id, group_id) on delete cascade
);

-- dependency_item_id is soft: targets may live outside the organization.
create table if not exists item_dependencies (
  org_id uuid not null,
  item_id text not null,
  dependency_item_id text not null,
  detected_at timestamptz,
  primary key (org_id, item_id, dependency_item_id),
  foreign key (org_id, item_id) references items (org_id, item_id) on delete cascade
);

create table if not exists item_services (
  org_id uuid not null,
  item_id text not null,
  service_type text,
  service_url text,
  hosted boolean,
  referenced boolean,
  tiled boolean,
  primary key (org_id, item_id),
  foreign key (org_id, item_id) references items (org_id, item_id) on delete cascade
);

create table if not exists item_usage (
  org_id uuid not null,
  item_id text not null,
  usage_date date not null,
  usage_count integer not null default 0,
  fetched_at timestamptz,
  primary key (org_id, item_id, usage_date),
  foreign key (org_id, item_id) references items (org_id, item_id) on delete cascade
);

create table if not exists licenses (
  org_id uuid not null references organizations (org_id) on delete cascade,
  license_id text not null,
  license_name text not null,
  license_kind text,
  available_seats integer,
  primary key (org_id, license_id)
);

create table if not exists user_licenses (
  org_id uuid not null,
  username text not null,
  license_id text not null,
  assigned_at timestamptz,
  primary key (org_id, username, license_id),
  foreign key (org_id, username) references users (org_id, username) on delete cascade,
  foreign key (org_id, license_id) references licenses (org_id, license_id) on delete cascade
);

create table if not exists credit_usage (
  credit_usage_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  period_start timestamptz not null,
  period_end timestamptz not null,
  category text,
  credits_used numeric,
  fetched_at timestamptz
);

create index if not exists credit_usage_org_period_idx
  on credit_usage (org_id, period_start desc);

create table if not exists storage_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  collected_at timestamptz not null default now(),
  used_bytes bigint,
  quota_bytes bigint,
  feature_store_percent numeric
);

create index if not exists storage_snapshots_org_collected_idx
  on storage_snapshots (org_id, collected_at desc);

create table if not exists change_history (
  history_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  action text not null,
  field_name text,
  old_value jsonb,
  new_value jsonb,
  actor_username text,
  occurred_at timestamptz,
  detected_at timestamptz not null default now(),
  source text,
  source_event_id text,
  run_id uuid references report_runs (run_id) on delete set null,
  confidence text,
  details_json jsonb
);

create index if not exists change_history_entity_time_idx
  on change_history (org_id, entity_type, entity_id, occurred_at);

create unique index if not exists change_history_source_event_uidx
  on change_history (org_id, source, source_event_id)
  where source_event_id is not null;

create table if not exists entity_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  entity_type text not null,
  entity_id text not null,
  observed_at timestamptz not null default now(),
  state_json jsonb not null,
  state_hash text,
  run_id uuid references report_runs (run_id) on delete set null,
  is_present boolean not null default true
);

create index if not exists entity_snapshots_entity_time_idx
  on entity_snapshots (org_id, entity_type, entity_id, observed_at desc);

create table if not exists audit_ingestion_state (
  ingestion_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  source_name text not null,
  last_cursor text,
  last_event_at timestamptz,
  last_success_at timestamptz,
  status text not null default 'idle',
  run_id uuid references report_runs (run_id) on delete set null,
  unique (org_id, source_name)
);

create table if not exists audit_coverage_gaps (
  gap_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  source_name text not null,
  gap_start timestamptz not null,
  gap_end timestamptz,
  reason text,
  severity text,
  resolved_at timestamptz,
  run_id uuid references report_runs (run_id) on delete set null
);

create index if not exists audit_coverage_gaps_org_source_idx
  on audit_coverage_gaps (org_id, source_name, gap_start desc);
