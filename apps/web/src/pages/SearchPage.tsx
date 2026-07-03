import { useState } from 'react'
import { useMutation } from '@tanstack/react-query'
import { api, ApiError } from '../lib/api'

interface Chunk {
  knowledgeItemId: string
  content: string
  titleSnapshot: string
  score: number
}
interface SearchResult {
  chunks: Chunk[]
  summary: string | null
  sources: { knowledgeItemId: string; titleSnapshot: string }[]
}

export function SearchPage() {
  const [query, setQuery] = useState('')
  const [summarize, setSummarize] = useState(true)

  const search = useMutation({
    mutationFn: (q: string) =>
      api.post<SearchResult>('/search', { query: q, topK: 5, summarize }),
  })

  function submit(e: React.FormEvent) {
    e.preventDefault()
    if (query.trim()) search.mutate(query.trim())
  }

  const result = search.data

  return (
    <div className="mx-auto max-w-3xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-800">Search</h1>
      <p className="mb-5 text-sm text-slate-400">
        Hybrid retrieval (semantic + keyword) with an AI-generated answer.
      </p>

      <form onSubmit={submit} className="flex gap-2">
        <input
          className="flex-1 rounded-xl border border-slate-300 px-4 py-3 text-sm outline-none focus:border-brand-500"
          placeholder="Ask anything about your team's knowledge…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          disabled={search.isPending}
          className="rounded-xl bg-brand-600 px-5 text-sm font-medium text-white hover:bg-brand-700 disabled:opacity-50"
        >
          {search.isPending ? '…' : 'Search'}
        </button>
      </form>

      <label className="mt-2 flex items-center gap-2 text-xs text-slate-400">
        <input type="checkbox" checked={summarize} onChange={(e) => setSummarize(e.target.checked)} />
        Generate AI summary (RAG)
      </label>

      {search.isError && (
        <p className="mt-4 text-sm text-rose-600">
          {search.error instanceof ApiError ? search.error.message : 'Search failed'}
        </p>
      )}

      {result && (
        <div className="mt-8 space-y-6">
          {result.summary ? (
            <div className="rounded-2xl border border-brand-100 bg-brand-50 p-5">
              <div className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-brand-600">
                <span>✨ AI Answer</span>
              </div>
              <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">
                {result.summary}
              </p>
              {result.sources.length > 0 && (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {result.sources.map((s, i) => (
                    <span
                      key={s.knowledgeItemId + i}
                      className="rounded-full bg-white px-2 py-0.5 text-[11px] text-brand-700 ring-1 ring-brand-100"
                    >
                      [{i + 1}] {s.titleSnapshot}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ) : (
            <div className="rounded-xl bg-slate-100 p-3 text-xs text-slate-500">
              No AI summary (disabled, or the summarizer/circuit is unavailable) — showing sources
              only.
            </div>
          )}

          <div>
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
              Sources · {result.chunks.length}
            </div>
            <div className="space-y-3">
              {result.chunks.map((c, i) => (
                <div
                  key={c.knowledgeItemId + i}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <div className="flex items-baseline justify-between">
                    <div className="text-sm font-medium text-slate-800">{c.titleSnapshot}</div>
                    <div className="text-[11px] text-slate-400">score {c.score.toFixed(3)}</div>
                  </div>
                  <p className="mt-1 line-clamp-3 text-xs leading-relaxed text-slate-500">
                    {c.content}
                  </p>
                </div>
              ))}
              {result.chunks.length === 0 && (
                <p className="text-sm text-slate-400">No results. Publish some knowledge first.</p>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
