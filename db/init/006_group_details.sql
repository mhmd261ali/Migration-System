-- Group page (from Groups overview/group_details.ipynb): full group metadata, member
-- names and join dates, and the metadata of each shared item as the group listing returns it.

alter table groups add column if not exists details jsonb;
alter table group_members add column if not exists full_name text;
-- Shared items can come from other organizations, so they are not always in items.
alter table item_group_shares add column if not exists item jsonb;
