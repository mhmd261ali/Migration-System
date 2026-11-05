-- Users, groups, memberships, and the analysis views (from org_data.py / org_data.ipynb).

-- Group members and shared items can come from other organizations, so they
-- may not exist in users / items.
alter table group_members drop constraint if exists group_members_org_id_username_fkey;
alter table item_group_shares drop constraint if exists item_group_shares_org_id_item_id_fkey;

create index if not exists group_members_user_idx on group_members (org_id, username);

alter table organizations add column if not exists fetched_as_admin boolean;
alter table organizations add column if not exists user_details_visible boolean;

-- false for owners known only from items or groups (for example from another organization).
alter table users add column if not exists is_member boolean not null default false;

alter table groups add column if not exists member_count integer;
alter table groups add column if not exists item_count integer;

-- Integer settings the views read (inactive_days, recent_days), written by the collector.
create table if not exists app_settings (
  org_id uuid not null references organizations (org_id) on delete cascade,
  setting_name text not null,
  setting_value integer not null,
  primary key (org_id, setting_name)
);

-- Stored counts compared with what ArcGIS Online reports, per collection.
create table if not exists collection_checks (
  check_id uuid primary key default gen_random_uuid(),
  org_id uuid not null references organizations (org_id) on delete cascade,
  run_id uuid references report_runs (run_id) on delete cascade,
  check_name text not null,
  expected integer,
  actual integer,
  ok boolean,
  details jsonb,
  checked_at timestamptz not null default now()
);

create index if not exists collection_checks_run_idx on collection_checks (run_id);

-- activity_status:
--   unknown          login dates not visible to the collecting account
--   never_logged_in  visible, and ArcGIS has no login
--   active           last login within inactive_days
--   inactive         last login older than inactive_days
create or replace view v_users as
select
  u.org_id,
  u.username,
  u.full_name,
  u.user_type_id,
  coalesce(t.name, u.user_type_id) as user_type,
  u.role_id,
  coalesce(r.name, u.role_id) as role_name,
  u.created_at,
  u.last_login_at,
  u.disabled,
  coalesce(i.items_owned, 0)::integer as items_owned,
  coalesce(i.items_modified_recent, 0)::integer as items_modified_recent,
  u.fetched_at,
  extract(day from now() - u.last_login_at)::integer as days_since_login,
  inactive.setting_value as inactive_days,
  case
    when o.user_details_visible is not true then 'unknown'
    when u.last_login_at is null then 'never_logged_in'
    when inactive.setting_value is null then 'unknown'
    when extract(day from now() - u.last_login_at) <= inactive.setting_value then 'active'
    else 'inactive'
  end as activity_status
from users u
join organizations o on o.org_id = u.org_id
left join roles r on r.org_id = u.org_id and r.role_id = u.role_id
left join user_types t on t.org_id = u.org_id and t.user_type_id = u.user_type_id
left join app_settings inactive on inactive.org_id = u.org_id and inactive.setting_name = 'inactive_days'
left join app_settings recent on recent.org_id = u.org_id and recent.setting_name = 'recent_days'
left join lateral (
  select
    count(*) as items_owned,
    count(*) filter (
      where it.modified_at >= coalesce(o.last_fetched_at, now()) - make_interval(days => coalesce(recent.setting_value, 90))
    ) as items_modified_recent
  from items it
  where it.org_id = u.org_id and it.owner_username = u.username
) i on true
where u.is_member;

-- modified changes when the group itself is edited, not when items are shared into it.
create or replace view v_groups as
select
  g.org_id,
  g.group_id,
  g.title,
  g.owner_username as owner,
  g.access,
  g.created_at,
  g.modified_at,
  coalesce(g.member_count, (select count(*) from group_members m where m.org_id = g.org_id and m.group_id = g.group_id))::integer as member_count,
  coalesce(g.item_count, (select count(*) from item_group_shares s where s.org_id = g.org_id and s.group_id = g.group_id))::integer as item_count,
  g.fetched_at,
  extract(day from now() - g.modified_at)::integer as days_since_modified
from groups g;
