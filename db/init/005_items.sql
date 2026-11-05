-- Item analysis (from items/functions.py): sizes, dependencies, empty checks, usage.

alter table items add column if not exists is_empty boolean;
alter table items add column if not exists usage_30d integer;

-- One row per item and per-item check (size, dependencies, empty, usage). It is the
-- cache: an item is read again only when it changed since item_modified_at, when a
-- failed read is due for a retry, or (usage) when the last read is a day old.
create table if not exists item_checks (
  org_id uuid not null,
  item_id text not null,
  check_name text not null,
  item_modified_at timestamptz,
  checked_at timestamptz not null,
  ok boolean not null,
  error text,
  primary key (org_id, item_id, check_name),
  foreign key (org_id, item_id) references items (org_id, item_id) on delete cascade
);

create index if not exists item_dependencies_target_idx on item_dependencies (org_id, dependency_item_id);
create index if not exists item_group_shares_item_idx on item_group_shares (org_id, item_id);

-- Counts are null when the check has not read the item yet, so "0" always means
-- "read, and none".
create or replace view v_items as
with dep as (
  select org_id, item_id, count(*)::integer as n
  from item_dependencies group by 1, 2
),
ref as (
  select d.org_id, d.dependency_item_id as item_id, count(distinct d.item_id)::integer as n
  from item_dependencies d group by 1, 2
),
shares as (
  select org_id, item_id, count(*)::integer as n
  from item_group_shares group by 1, 2
),
on_empty as (
  select distinct d.org_id, d.item_id
  from item_dependencies d
  join items e on e.org_id = d.org_id and e.item_id = d.dependency_item_id and e.is_empty
),
checks as (
  select org_id, item_id,
         bool_or(ok) filter (where check_name = 'dependencies') as dependencies_read,
         bool_or(ok) filter (where check_name = 'usage') as usage_read
  from item_checks group by 1, 2
)
select
  i.org_id,
  i.item_id,
  i.title,
  i.type,
  i.owner_username,
  i.access,
  i.created_at,
  i.modified_at,
  i.views,
  i.size_bytes,
  i.completeness_score,
  i.content_status,
  i.url,
  i.is_empty,
  i.usage_30d,
  extract(day from now() - i.modified_at)::integer as days_since_modified,
  (i.created_at is not null and i.modified_at <= i.created_at + interval '1 second') as never_modified,
  lower(coalesce(i.content_status, '')) = 'deprecated' as deprecated,
  coalesce(u.disabled and u.is_member, false) as owner_disabled,
  coalesce(s.n, 0) as share_count,
  case when c.dependencies_read then coalesce(dep.n, 0) end as dependency_count,
  coalesce(ref.n, 0) as referenced_count,
  case when c.dependencies_read then e.item_id is not null end as depends_on_empty
from items i
left join users u on u.org_id = i.org_id and u.username = i.owner_username
left join dep on dep.org_id = i.org_id and dep.item_id = i.item_id
left join ref on ref.org_id = i.org_id and ref.item_id = i.item_id
left join shares s on s.org_id = i.org_id and s.item_id = i.item_id
left join on_empty e on e.org_id = i.org_id and e.item_id = i.item_id
left join checks c on c.org_id = i.org_id and c.item_id = i.item_id;
