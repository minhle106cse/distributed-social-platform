import { useAuth } from '../store/auth'

// All calls go through the Vite dev-proxy → nginx gateway (:8000) → services.
const BASE = '/api/v1'

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code?: string,
  ) {
    super(message)
  }
}

interface Envelope<T> {
  success: boolean
  data: T
  message?: string
  error?: { code?: string; details?: unknown }
}

// Single-flight refresh: N requests hitting 401 at once trigger ONE
// POST /auth/refresh (refresh tokens rotate — a second concurrent call would
// burn the newly-issued token and log everyone out).
let refreshing: Promise<boolean> | null = null

function refreshSession(): Promise<boolean> {
  // `{}` body: the refresh route declares a (all-optional) body schema, so
  // Fastify 400s a body-less request — an empty JSON object satisfies it.
  refreshing ??= fetch(`${BASE}/auth/refresh`, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  })
    .then((res) => res.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null
    })
  return refreshing
}

async function request<T>(path: string, init: RequestInit = {}, isRetry = false): Promise<T> {
  const { token, orgId } = useAuth.getState()
  const headers: Record<string, string> = {
    // Only claim a JSON body when there IS one — Fastify rejects
    // content-type: application/json with an empty body (400 EMPTY_JSON_BODY).
    ...(init.body ? { 'content-type': 'application/json' } : {}),
    ...(init.headers as Record<string, string>),
  }
  // Primary auth = httpOnly accessToken cookie (set by auth-service, sent
  // automatically same-origin). Bearer is the dev-token fallback.
  if (token) headers['Authorization'] = `Bearer ${token}`
  if (orgId) headers['X-Org-Id'] = orgId

  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers,
    credentials: 'same-origin',
  })

  let body: Envelope<T> | null = null
  try {
    body = (await res.json()) as Envelope<T>
  } catch {
    // empty / non-JSON body
  }

  if (!res.ok) {
    if (res.status === 401) {
      // Access token (15 min) likely expired. For cookie sessions, try one
      // silent refresh (rotates the refresh-token cookie) and replay the
      // request. Never for /auth/* (would loop) or a request we already retried.
      const cookieSession = !token
      if (cookieSession && !isRetry && !path.startsWith('/auth/')) {
        if (await refreshSession()) {
          return request<T>(path, init, true)
        }
      }
      useAuth.getState().logout()
    }
    throw new ApiError(res.status, body?.message ?? res.statusText, body?.error?.code)
  }

  // Services wrap responses as { success, data }. Some return the payload directly.
  return (body && 'data' in body ? body.data : (body as unknown)) as T
}

export const api = {
  get: <T>(p: string) => request<T>(p),
  post: <T>(p: string, data?: unknown) =>
    request<T>(p, { method: 'POST', body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(p: string, data?: unknown) =>
    request<T>(p, { method: 'PATCH', body: data ? JSON.stringify(data) : undefined }),
}
