import { useState, useMemo, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../api'
import type { DashboardRow, HistoryEntry, ProgressSave } from '../types'

const today = new Date().toISOString().slice(0, 10)
const PAGE_SIZE = 100

interface RowEdit {
  installed_quantity: number
  entry_date: string
}

function useDebounce<T>(value: T, delay: number): T {
  const [debounced, setDebounced] = useState(value)
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), delay)
    return () => clearTimeout(t)
  }, [value, delay])
  return debounced
}

export default function Progress() {
  const [catFilter, setCatFilter] = useState('')
  const [search, setSearch] = useState('')
  const [progressOnly, setProgressOnly] = useState(false)
  const [page, setPage] = useState(1)
  const [edits, setEdits] = useState<Record<number, RowEdit>>({})
  const [historyId, setHistoryId] = useState<number | null>(null)

  const debouncedSearch = useDebounce(search, 300)

  const qc = useQueryClient()

  // Reset to page 1 whenever filters change
  useEffect(() => { setPage(1) }, [catFilter, debouncedSearch, progressOnly])

  const queryParams = { page, category: catFilter, search: debouncedSearch, progress_only: progressOnly }

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ['dashboard', queryParams],
    queryFn: () => api.dashboard(queryParams),
    placeholderData: (prev) => prev,
  })

  const rows = data?.rows ?? []
  const total = data?.total ?? 0
  const totalPages = Math.ceil(total / PAGE_SIZE)

  const { data: me = { user: '' } } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
  })

  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
  })

  const { data: history = [], isFetching: histFetching } = useQuery({
    queryKey: ['history', historyId],
    queryFn: () => api.history(historyId!),
    enabled: historyId !== null,
  })

  const saveMut = useMutation({
    mutationFn: (entries: ProgressSave[]) => api.saveProgress(entries),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setEdits({})
      toast.success(`${data.saved} entr${data.saved === 1 ? 'y' : 'ies'} saved`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const getEffective = (row: DashboardRow): RowEdit => ({
    installed_quantity: edits[row.id]?.installed_quantity ?? row.installed_quantity,
    entry_date: edits[row.id]?.entry_date ?? (row.entry_date ? row.entry_date.slice(0, 10) : today),
  })

  const changedCount = Object.keys(edits).length

  const handleSave = () => {
    if (changedCount === 0) { toast('No changes detected'); return }
    const entries: ProgressSave[] = Object.entries(edits).map(([id, change]) => ({
      boq_item_id: Number(id),
      installed_quantity: change.installed_quantity,
      entry_date: change.entry_date,
      changed_by: me.user,
    }))
    saveMut.mutate(entries)
  }

  const handleQtyChange = (row: DashboardRow, qty: number) => {
    const cur = getEffective(row)
    setEdits((prev) => ({ ...prev, [row.id]: { installed_quantity: qty, entry_date: cur.entry_date } }))
  }

  const handleDateChange = (row: DashboardRow, dt: string) => {
    const cur = getEffective(row)
    setEdits((prev) => ({ ...prev, [row.id]: { installed_quantity: cur.installed_quantity, entry_date: dt } }))
  }

  const toggleHistory = (id: number) => setHistoryId((prev) => (prev === id ? null : id))

  if (isLoading) {
    return <div className="flex items-center justify-center h-48 text-gray-400 text-sm">Loading…</div>
  }

  if (total === 0 && !catFilter && !debouncedSearch && !progressOnly) {
    return (
      <div className="text-center py-20 text-gray-400">
        <p className="text-5xl mb-4">📋</p>
        <p className="text-lg font-medium text-gray-500">No BOQ items yet</p>
        <p className="text-sm mt-1">Go to the <strong>Setup</strong> tab to add items.</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Filter bar */}
      <div className="flex flex-wrap gap-3 items-center bg-white border border-gray-200 rounded-lg px-4 py-3 shadow-sm">
        <select
          value={catFilter}
          onChange={(e) => setCatFilter(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
        >
          <option value="">All categories</option>
          {categories.map((c) => <option key={c.id} value={c.name}>{c.name}</option>)}
        </select>

        <input
          type="text"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Search code / description…"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-64 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />

        <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
          <input
            type="checkbox"
            checked={progressOnly}
            onChange={(e) => setProgressOnly(e.target.checked)}
            className="rounded accent-blue-600"
          />
          With progress only
        </label>

        <div className="ml-auto flex items-center gap-3">
          {changedCount > 0 && (
            <button onClick={() => setEdits({})} className="text-sm text-gray-400 hover:text-gray-600 underline">
              Discard
            </button>
          )}
          <button
            onClick={handleSave}
            disabled={changedCount === 0 || saveMut.isPending}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 disabled:cursor-not-allowed font-medium shadow-sm transition-colors"
          >
            {saveMut.isPending ? 'Saving…' : changedCount > 0 ? `Save (${changedCount})` : 'Save'}
          </button>
        </div>
      </div>

      {/* Table */}
      <div className={`overflow-x-auto rounded-lg border border-gray-200 shadow-sm bg-white transition-opacity ${isFetching ? 'opacity-60' : ''}`}>
        <table className="min-w-full divide-y divide-gray-100 text-sm">
          <thead>
            <tr className="bg-gray-50">
              {[
                { label: 'Category', cls: 'text-left' },
                { label: 'Code', cls: 'text-left' },
                { label: 'Description', cls: 'text-left' },
                { label: 'Unit', cls: 'text-center' },
                { label: 'Budget Qty', cls: 'text-right' },
                { label: 'Installed Qty', cls: 'text-right' },
                { label: 'Cutoff Date', cls: 'text-left' },
                { label: '📋', cls: 'text-center' },
              ].map((h) => (
                <th key={h.label} className={`px-3 py-2.5 ${h.cls} text-xs font-semibold text-gray-500 uppercase tracking-wider`}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {rows.map((row) => {
              const eff = getEffective(row)
              const isChanged = row.id in edits
              const isHistory = historyId === row.id
              const pct = row.budget_quantity > 0
                ? Math.min(100, (eff.installed_quantity / row.budget_quantity) * 100) : 0

              return (
                <>
                  <tr
                    key={row.id}
                    className={`transition-colors ${isHistory ? 'bg-blue-50' : isChanged ? 'bg-amber-50' : 'hover:bg-gray-50'}`}
                  >
                    <td className="px-3 py-2 text-gray-500 whitespace-nowrap">{row.category}</td>
                    <td className="px-3 py-2 font-mono font-semibold text-gray-800 whitespace-nowrap">{row.code}</td>
                    <td className="px-3 py-2 text-gray-700 max-w-sm">
                      <div className="truncate" title={row.description}>{row.description}</div>
                    </td>
                    <td className="px-3 py-2 text-center text-gray-500">{row.unit}</td>
                    <td className="px-3 py-2 text-right tabular-nums text-gray-600">{row.budget_quantity.toFixed(3)}</td>
                    <td className="px-3 py-2">
                      <div className="flex flex-col gap-1">
                        <input
                          type="number" min="0" step="0.001"
                          value={eff.installed_quantity}
                          onChange={(e) => handleQtyChange(row, parseFloat(e.target.value) || 0)}
                          className="w-28 px-2 py-1 border border-gray-300 rounded text-right text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none tabular-nums"
                        />
                        {row.budget_quantity > 0 && (
                          <div className="w-28">
                            <div className="h-1 bg-gray-200 rounded-full">
                              <div
                                className={`h-1 rounded-full transition-all ${pct >= 100 ? 'bg-green-500' : pct > 0 ? 'bg-blue-500' : 'bg-gray-300'}`}
                                style={{ width: `${pct}%` }}
                              />
                            </div>
                            <span className="text-xs text-gray-400 tabular-nums">{pct.toFixed(1)}%</span>
                          </div>
                        )}
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="date" value={eff.entry_date}
                        onChange={(e) => handleDateChange(row, e.target.value)}
                        className="px-2 py-1 border border-gray-300 rounded text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none"
                      />
                    </td>
                    <td className="px-3 py-2 text-center">
                      <button
                        onClick={() => toggleHistory(row.id)}
                        title="Toggle history"
                        className={`text-base transition-colors ${isHistory ? 'text-blue-600' : 'text-gray-300 hover:text-blue-400'}`}
                      >
                        📋
                      </button>
                    </td>
                  </tr>
                  {isHistory && (
                    <tr key={`history-${row.id}`} className="bg-blue-50">
                      <td colSpan={8} className="px-6 py-3 border-t border-blue-100">
                        {histFetching ? (
                          <p className="text-sm text-blue-500">Loading history…</p>
                        ) : history.length === 0 ? (
                          <p className="text-sm text-blue-500">No history entries yet.</p>
                        ) : (
                          <table className="min-w-full text-sm">
                            <thead>
                              <tr className="text-xs text-blue-600 uppercase">
                                <th className="py-1 pr-6 text-left font-semibold">Date</th>
                                <th className="py-1 pr-6 text-right font-semibold">Installed Qty</th>
                                <th className="py-1 pr-6 text-left font-semibold">Changed By</th>
                                <th className="py-1 text-left font-semibold">Changed At</th>
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-blue-100">
                              {(history as HistoryEntry[]).map((h, i) => (
                                <tr key={i}>
                                  <td className="py-1.5 pr-6">{h.entry_date}</td>
                                  <td className="py-1.5 pr-6 text-right tabular-nums">{Number(h.installed_quantity).toFixed(3)}</td>
                                  <td className="py-1.5 pr-6 text-gray-600">{h.changed_by}</td>
                                  <td className="py-1.5 text-gray-400 text-xs">{h.changed_at}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        )}
                      </td>
                    </tr>
                  )}
                </>
              )
            })}
          </tbody>
        </table>
        {rows.length === 0 && (
          <div className="text-center py-10 text-gray-400 text-sm">No items match your filters.</div>
        )}
      </div>

      {/* Footer: stats + pagination */}
      <div className="flex items-center justify-between text-xs text-gray-400">
        <span>
          {total.toLocaleString()} items total
          {isFetching && <span className="ml-2 text-blue-400">loading…</span>}
          {changedCount > 0 && (
            <span className="ml-2 text-amber-600 font-medium">• {changedCount} unsaved change{changedCount !== 1 ? 's' : ''}</span>
          )}
        </span>

        {totalPages > 1 && (
          <div className="flex items-center gap-1">
            <button
              onClick={() => setPage(1)}
              disabled={page === 1}
              className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >«</button>
            <button
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >‹</button>
            <span className="px-3 py-1 text-gray-600 font-medium">
              {page} / {totalPages}
            </span>
            <button
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page === totalPages}
              className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >›</button>
            <button
              onClick={() => setPage(totalPages)}
              disabled={page === totalPages}
              className="px-2 py-1 rounded hover:bg-gray-100 disabled:opacity-30"
            >»</button>
          </div>
        )}
      </div>
    </div>
  )
}
