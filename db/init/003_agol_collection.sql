-- Fields the agol collection scripts return that 002 had no place for.

-- organization.profile
alter table organizations add column if not exists arcgis_id text;
alter table organizations add column if not exists culture text;
alter table organizations add column if not exists units text;
alter table organizations add column if not exists access text;
alter table organizations add column if not exists portal_name text;
alter table organizations add column if not exists is_enterprise boolean;
alter table organizations add column if not exists portal_mode text;
alter table organizations add column if not exists portal_version text;
alter table organizations add column if not exists read_only boolean;
alter table organizations add column if not exists source_created_at timestamptz;
alter table organizations add column if not exists source_modified_at timestamptz;

create unique index if not exists organizations_arcgis_id_uidx
  on organizations (arcgis_id)
  where arcgis_id is not null;

-- organization.security / maps / settings, one row per value
alter table organization_settings add column if not exists section text not null default 'settings';

create index if not exists organization_settings_section_idx
  on organization_settings (org_id, section);

-- organization.subscription
alter table subscriptions add column if not exists user_license_types jsonb;
alter table subscriptions add column if not exists fetched_at timestamptz;

-- members.roles
alter table roles add column if not exists member_count integer;
alter table roles add column if not exists fetched_at timestamptz;

-- members.counts and usage.licenses user types
alter table user_types add column if not exists assigned_count integer;
alter table user_types add column if not exists fetched_at timestamptz;

-- built-in role key (org_admin, org_publisher, org_user) when no role definition exists
alter table users add column if not exists role text;

-- members.invitations
alter table invitations add column if not exists role text;
alter table invitations add column if not exists user_type text;
alter table invitations add column if not exists expires_at timestamptz;
alter table invitations add column if not exists details jsonb;
alter table invitations add column if not exists fetched_at timestamptz;

-- groups.FIELDS
alter table groups add column if not exists is_invitation_only boolean;
alter table groups add column if not exists is_view_only boolean;
alter table groups add column if not exists protected boolean;
alter table groups add column if not exists auto_join boolean;
alter table groups add column if not exists tags text[];
alter table groups add column if not exists fetched_at timestamptz;

-- content.FIELDS
alter table items add column if not exists num_comments integer;
alter table items add column if not exists num_ratings integer;
alter table items add column if not exists avg_rating numeric;
alter table items add column if not exists type_keywords text[];
alter table items add column if not exists url text;
alter table items add column if not exists fetched_at timestamptz;

create index if not exists items_org_type_idx on items (org_id, type);
create index if not exists items_org_owner_idx on items (org_id, owner_username);

-- content.services
alter table item_services add column if not exists detected_at timestamptz;

-- usage.licenses add-ons, apps, bundles
alter table licenses add column if not exists assigned_count integer;
alter table licenses add column if not exists fetched_at timestamptz;

-- usage.credits per category
alter table credit_usage add column if not exists run_id uuid references report_runs (run_id) on delete set null;

-- usage.credits totals
create table if not exists credit_snapshots (
  snapshot_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  collected_at timestamptz not null default now(),
  balance numeric,
  budgeting_enabled boolean,
  default_limit numeric,
  member_count integer,
  sum_of_default_caps numeric,
  run_id uuid references report_runs (run_id) on delete set null
);

create index if not exists credit_snapshots_org_collected_idx
  on credit_snapshots (org_id, collected_at desc);

-- usage.storage
alter table storage_snapshots add column if not exists feature_store_at timestamptz;
alter table storage_snapshots add column if not exists run_id uuid references report_runs (run_id) on delete set null;

-- report.collect run bookkeeping
alter table report_runs add column if not exists connection_id uuid references connections (id) on delete set null;
alter table report_runs add column if not exists signed_in_username text;
alter table report_runs add column if not exists signed_in_role text;
alter table report_runs add column if not exists summary jsonb;
alter table report_runs add column if not exists error_details jsonb;
alter table report_runs add column if not exists collector_pid integer;
alter table report_runs add column if not exists requested_by text;
