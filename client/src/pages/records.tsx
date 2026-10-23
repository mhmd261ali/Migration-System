import { StatusPill } from '../components/ui'
import { blank, formatWhen } from '../format'
import type { ActivityRow, ConnectionRow, ContentRow, GroupRow, JobRow, UserRow } from '../types'
import { RecordPage } from './RecordPage'

export function UsersOverview() {
  return (
    <RecordPage<UserRow>
      title="Users Overview"
      description="Accounts this console knows about. They show up here after a connection is read."
      path="/users"
      singular="user"
      plural="users"
      empty="No users recorded yet."
      columns={[
        { header: 'Name', cell: (row) => row.display_name },
        { header: 'Username', cell: (row) => <span className="font-mono text-[13px]">{row.username}</span> },
        { header: 'Email', cell: (row) => blank(row.email) },
        { header: 'Role', cell: (row) => blank(row.role_name) },
        { header: 'Source', cell: (row) => row.source },
        { header: 'Status', cell: (row) => <StatusPill value={row.status} /> },
      ]}
    />
  )
}

export function GroupsOverview() {
  return (
    <RecordPage<GroupRow>
      title="Groups Overview"
      description="Groups this console knows about, including how many members each one has."
      path="/groups"
      singular="group"
      plural="groups"
      empty="No groups recorded yet."
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Type', cell: (row) => blank(row.group_type) },
        { header: 'Members', cell: (row) => row.member_count },
        { header: 'Owner', cell: (row) => blank(row.owner_name) },
        { header: 'Source', cell: (row) => row.source },
      ]}
    />
  )
}

export function ContentOverview() {
  return (
    <RecordPage<ContentRow>
      title="Content Overview"
      description="Maps, layers, and other portal items this console knows about."
      path="/content"
      singular="item"
      plural="items"
      empty="No content recorded yet."
      columns={[
        { header: 'Title', cell: (row) => row.title },
        { header: 'Type', cell: (row) => row.item_type },
        { header: 'Owner', cell: (row) => blank(row.owner_name) },
        { header: 'Folder', cell: (row) => blank(row.folder) },
        { header: 'Portal', cell: (row) => blank(row.portal) },
        { header: 'Modified', cell: (row) => formatWhen(row.modified_at) },
      ]}
    />
  )
}

export function JobsPage() {
  return (
    <RecordPage<JobRow>
      title="Migration Jobs"
      description="Runs that have been queued or finished. A run is created from Migration Studio."
      path="/jobs"
      singular="job"
      plural="jobs"
      empty="No migration jobs yet."
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Status', cell: (row) => <StatusPill value={row.status} /> },
        { header: 'Created', cell: (row) => formatWhen(row.created_at) },
      ]}
    />
  )
}

export function HistoryPage() {
  return (
    <RecordPage<ActivityRow>
      title="History and Activity"
      description="Sign-ins and the actions this console records, newest first."
      path="/activity"
      singular="event"
      plural="events"
      empty="No activity recorded yet."
      columns={[
        { header: 'When', cell: (row) => formatWhen(row.occurred_at) },
        { header: 'Actor', cell: (row) => row.actor },
        { header: 'Action', cell: (row) => row.action },
        { header: 'Target', cell: (row) => blank(row.target) },
      ]}
    />
  )
}

export function ConnectionsPage() {
  return (
    <RecordPage<ConnectionRow>
      title="Connections"
      description="ArcGIS portals and other endpoints this console can read or write."
      path="/connections"
      singular="connection"
      plural="connections"
      empty="No connections configured yet."
      columns={[
        { header: 'Name', cell: (row) => row.name },
        { header: 'Kind', cell: (row) => row.kind },
        { header: 'Portal', cell: (row) => <span className="font-mono text-[13px]">{row.portal_url}</span> },
        { header: 'Status', cell: (row) => <StatusPill value={row.status} /> },
        { header: 'Added', cell: (row) => formatWhen(row.created_at) },
      ]}
    />
  )
}
