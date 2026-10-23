import { Navigate, Outlet, Route, Routes } from 'react-router-dom'
import { useAuthReady, useOptionalSession } from './auth/AuthProvider'
import { AppShell } from './layout/AppShell'
import { ChangeTrackingPage } from './pages/ChangeTrackingPage'
import { HomePage } from './pages/HomePage'
import { OpeningConsole } from './pages/OpeningConsole'
import {
  ConnectionsPage,
  ContentOverview,
  GroupsOverview,
  HistoryPage,
  JobsPage,
  UsersOverview,
} from './pages/records'
import { SettingsPage } from './pages/SettingsPage'
import { StudioPage } from './pages/StudioPage'
import { SystemOverview } from './pages/SystemOverview'

export function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route element={<RequireSession />}>
        <Route element={<AppShell />}>
          <Route path="/overview" element={<SystemOverview />} />
          <Route path="/users" element={<UsersOverview />} />
          <Route path="/groups" element={<GroupsOverview />} />
          <Route path="/content" element={<ContentOverview />} />
          <Route path="/studio" element={<StudioPage />} />
          <Route path="/jobs" element={<JobsPage />} />
          <Route path="/changes" element={<ChangeTrackingPage />} />
          <Route path="/history" element={<HistoryPage />} />
          <Route path="/connections" element={<ConnectionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
          <Route path="*" element={<Navigate to="/overview" replace />} />
        </Route>
      </Route>
    </Routes>
  )
}

function RequireSession() {
  const ready = useAuthReady()
  const session = useOptionalSession()
  if (!ready) {
    const value = `${window.location.hash}${window.location.search}`
    if (value.includes('code=') || value.includes('state=')) return <OpeningConsole />
    return null
  }
  if (!session) return <Navigate to="/" replace />
  return <Outlet />
}
