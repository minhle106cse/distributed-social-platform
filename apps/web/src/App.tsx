import { Navigate, Route, Routes } from 'react-router-dom'
import { useAuth } from './store/auth'
import { Layout } from './components/Layout'
import { LoginPage } from './pages/LoginPage'
import { SearchPage } from './pages/SearchPage'
import { KnowledgePage } from './pages/KnowledgePage'
import { NotificationsPage } from './pages/NotificationsPage'
import type { JSX } from 'react'

function RequireAuth({ children }: { children: JSX.Element }) {
  const authed = useAuth((s) => s.authed)
  return authed ? children : <Navigate to="/login" replace />
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        element={
          <RequireAuth>
            <Layout />
          </RequireAuth>
        }
      >
        <Route path="/" element={<Navigate to="/search" replace />} />
        <Route path="/search" element={<SearchPage />} />
        <Route path="/knowledge" element={<KnowledgePage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/search" replace />} />
    </Routes>
  )
}
