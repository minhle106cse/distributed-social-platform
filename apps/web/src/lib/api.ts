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

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
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
    if (res.status === 401) useAuth.getState().logout()
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
