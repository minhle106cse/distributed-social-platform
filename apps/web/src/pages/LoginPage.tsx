import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { api, ApiError } from '../lib/api'
import { useAuth } from '../store/auth'

export function LoginPage() {
  const navigate = useNavigate()
  const { loginWithCookie, setToken, setOrgId } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // No "list my orgs" endpoint yet — the user pastes their org id at sign-in.
  const [orgIdInput, setOrgIdInput] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  // Dev token fallback — paste an RS256 JWT (sent as Bearer) when you don't
  // have a registered account (e.g. smoke-test tokens).
  const [showDev, setShowDev] = useState(false)
  const [devToken, setDevToken] = useState('')
  const [devOrg, setDevOrg] = useState('')

  async function handleLogin(e: React.FormEvent) {
    e.preventDefault()
    setError(null)
    setBusy(true)
    try {
      // auth-service sets httpOnly accessToken/refreshToken cookies (RS256).
      // The SPA never sees the token — the cookie rides along on every call.
      await api.post('/auth/login', { email, password })
      loginWithCookie(email)
      if (orgIdInput.trim()) setOrgId(orgIdInput.trim())
      navigate('/search')
    } catch (err) {
      setError(err instanceof ApiError ? err.message : (err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  function handleDev(e: React.FormEvent) {
    e.preventDefault()
    if (!devToken.trim() || !devOrg.trim()) return
    setToken(devToken.trim())
    setOrgId(devOrg.trim())
    navigate('/search')
  }

  return (
    <div className="flex h-full items-center justify-center bg-gradient-to-br from-brand-50 to-slate-100">
      <div className="w-full max-w-sm rounded-2xl border border-slate-200 bg-white p-8 shadow-sm">
        <div className="mb-6 text-center">
          <div className="text-2xl font-bold text-brand-600">Cortex</div>
          <div className="text-sm text-slate-400">Team Knowledge Hub</div>
        </div>

        <form onSubmit={handleLogin} className="space-y-3">
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            placeholder="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            placeholder="password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
          <input
            className="w-full rounded-lg border border-slate-300 px-3 py-2 font-mono text-xs outline-none focus:border-brand-500"
            placeholder="Org ID (uuid) — dán org của bạn"
            value={orgIdInput}
            onChange={(e) => setOrgIdInput(e.target.value)}
          />
          <button
            disabled={busy}
            className="w-full rounded-lg bg-brand-600 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>

        {error && <p className="mt-3 text-xs text-rose-600">{error}</p>}

        <button
          onClick={() => setShowDev((v) => !v)}
          className="mt-5 w-full text-center text-xs text-slate-400 hover:text-slate-600"
        >
          {showDev ? 'Hide dev token' : 'Use dev token (demo)'}
        </button>

        {showDev && (
          <form onSubmit={handleDev} className="mt-3 space-y-2 rounded-lg bg-slate-50 p-3">
            <textarea
              className="h-20 w-full rounded border border-slate-300 px-2 py-1 font-mono text-[10px] outline-none"
              placeholder="paste RS256 JWT"
              value={devToken}
              onChange={(e) => setDevToken(e.target.value)}
            />
            <input
              className="w-full rounded border border-slate-300 px-2 py-1 font-mono text-[11px] outline-none"
              placeholder="X-Org-Id (uuid)"
              value={devOrg}
              onChange={(e) => setDevOrg(e.target.value)}
            />
            <button className="w-full rounded bg-slate-700 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
              Enter with dev token
            </button>
          </form>
        )}
      </div>
    </div>
  )
}
