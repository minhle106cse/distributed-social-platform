import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'

interface KnowledgeItem {
  id: string
  title: string
  type: string
  status: string
  spaceId: string
  createdAt: string
}

const TYPES = ['DOCUMENT', 'QUESTION', 'ANSWER', 'RUNBOOK', 'ADR'] as const

export function KnowledgePage() {
  const qc = useQueryClient()
  const [form, setForm] = useState({ spaceId: '', type: 'DOCUMENT', title: '', body: '' })
  const [error, setError] = useState<string | null>(null)

  const list = useQuery({
    queryKey: ['knowledge'],
    queryFn: () => api.get<{ items: KnowledgeItem[] } | KnowledgeItem[]>('/knowledge?limit=50'),
  })
  const items = Array.isArray(list.data) ? list.data : (list.data?.items ?? [])

  const create = useMutation({
    mutationFn: () =>
      api.post<{ id: string }>('/knowledge', {
        spaceId: form.spaceId,
        type: form.type,
        title: form.title,
        body: form.body,
      }),
    onSuccess: () => {
      setForm({ ...form, title: '', body: '' })
      qc.invalidateQueries({ queryKey: ['knowledge'] })
    },
    onError: (e) => setError(e instanceof ApiError ? e.message : 'Create failed'),
  })

  const publish = useMutation({
    mutationFn: (id: string) => api.post(`/knowledge/${id}/publish`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['knowledge'] }),
  })

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-800">Knowledge</h1>
      <p className="mb-5 text-sm text-slate-400">
        Create and publish items. Publishing fans out to followers + indexes for search.
      </p>

      <div className="mb-8 rounded-2xl border border-slate-200 bg-white p-5">
        <div className="grid grid-cols-2 gap-2">
          <input
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            placeholder="space id (uuid)"
            value={form.spaceId}
            onChange={(e) => setForm({ ...form, spaceId: e.target.value })}
          />
          <select
            className="rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            {TYPES.map((t) => (
              <option key={t}>{t}</option>
            ))}
          </select>
        </div>
        <input
          className="mt-2 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          placeholder="title"
          value={form.title}
          onChange={(e) => setForm({ ...form, title: e.target.value })}
        />
        <textarea
          className="mt-2 h-28 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
          placeholder="body"
          value={form.body}
          onChange={(e) => setForm({ ...form, body: e.target.value })}
        />
        <button
          disabled={create.isPending || !form.spaceId || !form.title || !form.body}
          onClick={() => {
            setError(null)
            create.mutate()
          }}
          className="mt-2 rounded-lg bg-brand-600 px-4 py-2 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {create.isPending ? 'Creating…' : 'Create draft'}
        </button>
        {error && <p className="mt-2 text-xs text-rose-600">{error}</p>}
      </div>

      {list.isError && (
        <p className="text-sm text-rose-600">
          Could not load items{' '}
          {list.error instanceof ApiError && list.error.status === 403
            ? '(need org membership — this endpoint uses OrgGuard).'
            : '.'}
        </p>
      )}

      <div className="space-y-2">
        {items.map((it) => (
          <div
            key={it.id}
            className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-4"
          >
            <div>
              <div className="text-sm font-medium text-slate-800">{it.title}</div>
              <div className="text-[11px] text-slate-400">
                {it.type} ·{' '}
                <span className={it.status === 'PUBLISHED' ? 'text-emerald-600' : 'text-amber-600'}>
                  {it.status}
                </span>
              </div>
            </div>
            {it.status === 'DRAFT' && (
              <button
                onClick={() => publish.mutate(it.id)}
                className="rounded-lg border border-brand-200 px-3 py-1.5 text-xs font-medium text-brand-600 hover:bg-brand-50"
              >
                Publish
              </button>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
