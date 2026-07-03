import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface JwtClaims {
  sub: string
  email?: string
}

function decodeJwt(token: string): JwtClaims | null {
  try {
    const payload = token.split('.')[1]
    return JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/')))
  } catch {
    return null
  }
}

interface AuthState {
  // Primary auth = httpOnly accessToken cookie set by auth-service (RS256).
  // The SPA can't read that cookie, so we track "authed" ourselves; the cookie
  // rides along automatically on same-origin requests via the gateway proxy.
  authed: boolean
  // Dev/demo fallback: a pasted JWT sent as Authorization: Bearer.
  token: string | null
  orgId: string | null
  email: string | null
  userId: string | null
  loginWithCookie: (email: string) => void
  setToken: (token: string) => void
  setOrgId: (orgId: string) => void
  logout: () => void
}

export const useAuth = create<AuthState>()(
  persist(
    (set) => ({
      authed: false,
      token: null,
      orgId: null,
      email: null,
      userId: null,
      loginWithCookie: (email) => set({ authed: true, token: null, email }),
      setToken: (token) => {
        const claims = decodeJwt(token)
        set({ authed: true, token, email: claims?.email ?? null, userId: claims?.sub ?? null })
      },
      setOrgId: (orgId) => set({ orgId }),
      logout: () => set({ authed: false, token: null, email: null, userId: null }),
    }),
    { name: 'cortex-auth' },
  ),
)
