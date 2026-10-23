-- Foundation tables for the migration console.
-- They stay empty until a later brick reads a portal or records work.

create table if not exists directory_users (
  id uuid primary key default gen_random_uuid(),
  username text not null,
  display_name text not null,
  email text,
  role_name text,
  source text not null default 'portal',
  status text not null default 'active',
  last_seen_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists directory_groups (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  group_type text,
  member_count integer not null default 0,
  owner_name text,
  source text not null default 'portal',
  created_at timestamptz not null default now()
);

create table if not exists content_items (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  item_type text not null,
  owner_name text,
  folder text,
  portal text,
  modified_at timestamptz,
  created_at timestamptz not null default now()
);

create table if not exists connections (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null,
  portal_url text not null,
  status text not null default 'unconfigured',
  created_at timestamptz not null default now()
);

create table if not exists migration_jobs (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  status text not null default 'draft',
  created_at timestamptz not null default now()
);

create table if not exists activity_events (
  id uuid primary key default gen_random_uuid(),
  actor text not null,
  action text not null,
  target text,
  occurred_at timestamptz not null default now()
);
