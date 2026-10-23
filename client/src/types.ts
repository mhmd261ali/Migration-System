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

export type UserRow = {
  id: string
  username: string
  display_name: string
  email: string | null
  role_name: string | null
  source: string
  status: string
  last_seen_at: string | null
}

export type GroupRow = {
  id: string
  name: string
  group_type: string | null
  member_count: number
  owner_name: string | null
  source: string
}

export type ContentRow = {
  id: string
  title: string
  item_type: string
  owner_name: string | null
  folder: string | null
  portal: string | null
  modified_at: string | null
}

export type ConnectionRow = {
  id: string
  name: string
  kind: string
  portal_url: string
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
