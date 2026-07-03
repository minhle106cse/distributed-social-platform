import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { api } from '../lib/api'

interface Notification {
  id: string
  type: string
  titleSnapshot: string
  actorUserId: string
  itemId: string
  spaceId: string
  readAt: string | null
  createdAt: string
}

export function NotificationsPage() {
  const qc = useQueryClient()
  const { data, isLoading, isError } = useQuery({
    queryKey: ['notifications'],
    queryFn: () => api.get<Notification[]>('/notifications?limit=50'),
  })

  const markRead = useMutation({
    mutationFn: (id: string) => api.patch(`/notifications/${id}/read`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['notifications'] }),
  })

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <h1 className="text-xl font-semibold text-slate-800">Notifications</h1>
      <p className="mb-5 text-sm text-slate-400">New items in spaces you follow.</p>

      {isLoading && <p className="text-sm text-slate-400">Loading…</p>}
      {isError && <p className="text-sm text-rose-600">Could not load notifications.</p>}

      <div className="space-y-2">
        {data?.map((n) => (
          <div
            key={n.id}
            className={`flex items-start gap-3 rounded-xl border p-4 ${
              n.readAt ? 'border-slate-200 bg-white' : 'border-brand-100 bg-brand-50'
            }`}
          >
            <div className="text-lg">🔔</div>
            <div className="flex-1">
              <div className="text-sm text-slate-700">
                New in a space: <span className="font-medium">{n.titleSnapshot}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-slate-400">
                {n.type} · {new Date(n.createdAt).toLocaleString()}
              </div>
            </div>
            {!n.readAt && (
              <button
                onClick={() => markRead.mutate(n.id)}
                className="text-[11px] text-brand-600 hover:underline"
              >
                mark read
              </button>
            )}
          </div>
        ))}
        {data?.length === 0 && (
          <p className="text-sm text-slate-400">
            No notifications yet. Follow a space and publish an item to see fan-out here.
          </p>
        )}
      </div>
    </div>
  )
}
