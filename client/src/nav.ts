export type IconName =
  | 'grid'
  | 'users'
  | 'groups'
  | 'content'
  | 'studio'
  | 'jobs'
  | 'changes'
  | 'history'
  | 'connections'
  | 'settings'

export type NavItem = {
  label: string
  to: string
  icon: IconName
}

export type NavSection = {
  label: string
  items: NavItem[]
}

export const navigation: NavSection[] = [
  {
    label: 'Overview',
    items: [
      { label: 'System Overview', to: '/overview', icon: 'grid' },
      { label: 'Users Overview', to: '/users', icon: 'users' },
      { label: 'Groups Overview', to: '/groups', icon: 'groups' },
      { label: 'Content Overview', to: '/content', icon: 'content' },
    ],
  },
  {
    label: 'Operations',
    items: [
      { label: 'Migration Studio', to: '/studio', icon: 'studio' },
      { label: 'Migration Jobs', to: '/jobs', icon: 'jobs' },
      { label: 'Change Tracking', to: '/changes', icon: 'changes' },
      { label: 'History and Activity', to: '/history', icon: 'history' },
    ],
  },
  {
    label: 'Configuration',
    items: [
      { label: 'Connections', to: '/connections', icon: 'connections' },
      { label: 'Settings', to: '/settings', icon: 'settings' },
    ],
  },
]

export const navItems = navigation.flatMap((section) => section.items)
