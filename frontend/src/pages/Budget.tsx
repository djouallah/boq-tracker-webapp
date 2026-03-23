import { useState, ReactNode, useEffect, useRef } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../api'
import type { BoqItem, AuditEntry } from '../types'

// ── Accordion ─────────────────────────────────────────────────────────────────

function Section({ title, children }: { title: string; children: ReactNode }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden shadow-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full text-left px-4 py-3 flex items-center justify-between bg-white hover:bg-gray-50 font-medium text-gray-700 text-sm transition-colors"
      >
        {title}
        <span
          className={`text-gray-400 text-xs transition-transform duration-200 ${open ? 'rotate-180' : ''}`}
        >
          ▼
        </span>
      </button>
      {open && <div className="px-4 py-4 border-t border-gray-100 bg-white">{children}</div>}
    </div>
  )
}

// ── Import timer ──────────────────────────────────────────────────────────────

function useImportTimer(isPending: boolean) {
  const [elapsed, setElapsed] = useState<number | null>(null)
  const [done, setDone] = useState<number | null>(null)
  const startRef = useRef<number | null>(null)

  useEffect(() => {
    if (isPending) {
      startRef.current = Date.now()
      setDone(null)
      setElapsed(0)
      const id = setInterval(() => setElapsed(Date.now() - startRef.current!), 100)
      return () => clearInterval(id)
    } else if (startRef.current !== null) {
      setDone(Date.now() - startRef.current)
      startRef.current = null
      setElapsed(null)
    }
  }, [isPending])

  return { elapsed, done }
}

function ImportTimer({ isPending, count }: { isPending: boolean; count: number | null }) {
  const { elapsed, done } = useImportTimer(isPending)
  if (isPending && elapsed !== null)
    return <span className="text-sm text-gray-400">{(elapsed / 1000).toFixed(1)}s…</span>
  if (!isPending && done !== null && count !== null)
    return <span className="text-sm text-green-600">✓ {count.toLocaleString()} rows in {(done / 1000).toFixed(1)}s</span>
  return null
}

// ── Categories ────────────────────────────────────────────────────────────────

function Categories() {
  const qc = useQueryClient()
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
  })
  const [newName, setNewName] = useState('')

  const addMut = useMutation({
    mutationFn: (name: string) => api.addCategory(name),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      setNewName('')
      toast.success('Category added')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delMut = useMutation({
    mutationFn: (id: number) => api.deleteCategory(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['categories'] })
      toast.success('Category deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const handleAdd = () => {
    const name = newName.trim()
    if (!name) return
    addMut.mutate(name)
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          value={newName}
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAdd()}
          placeholder="New category name (no spaces, e.g. civil_works)"
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm flex-1 focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
        <button
          onClick={handleAdd}
          disabled={!newName.trim() || addMut.isPending}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium"
        >
          {addMut.isPending ? 'Adding…' : 'Add'}
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {categories.map((c) => (
          <span
            key={c.id}
            className="flex items-center gap-1.5 bg-gray-100 border border-gray-200 rounded-full px-3 py-1 text-sm text-gray-700"
          >
            {c.name}
            <button
              onClick={() => {
                if (confirm(`Delete category "${c.name}"? This may fail if items are assigned to it.`)) {
                  delMut.mutate(c.id)
                }
              }}
              className="text-gray-400 hover:text-red-500 font-bold leading-none"
              title={`Delete ${c.name}`}
            >
              ✕
            </button>
          </span>
        ))}
        {categories.length === 0 && (
          <span className="text-sm text-gray-400 italic">No categories yet.</span>
        )}
      </div>
    </div>
  )
}

// ── Import BOQ ────────────────────────────────────────────────────────────────

const BOQ_TEMPLATE = 'category,code,description,unit,budget_quantity\ncivil_works,CW.001,Install concrete foundations,m3,500\npipes,PI.001,Install water pipe,m,1000\n'

function ImportBoq() {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null)
  const [lastCount, setLastCount] = useState<number | null>(null)

  const previewMut = useMutation({
    mutationFn: (f: File) => api.previewBoqImport(f),
    onSuccess: (data) => setPreview(data.rows),
    onError: (e: Error) => toast.error(e.message),
  })

  const confirmMut = useMutation({
    mutationFn: () => api.confirmBoqImport(),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['boq-items'] })
      qc.invalidateQueries({ queryKey: ['categories'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setLastCount(data.count)
      setFile(null)
      setPreview(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const COLS = ['category', 'code', 'description', 'unit', 'budget_quantity']

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Required columns:{' '}
        {COLS.map((c) => (
          <code key={c} className="bg-gray-100 px-1 rounded text-xs mx-0.5">
            {c}
          </code>
        ))}
      </p>
      <a
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(BOQ_TEMPLATE)}`}
        download="boq_template.csv"
        className="inline-block text-sm text-blue-600 hover:text-blue-800 hover:underline"
      >
        ↓ Download template
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPreview(null)
          }}
          className="text-sm text-gray-600"
        />
        {file && !preview && (
          <button
            onClick={() => previewMut.mutate(file)}
            disabled={previewMut.isPending}
            className="px-4 py-1.5 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-40"
          >
            {previewMut.isPending ? 'Parsing…' : 'Preview'}
          </button>
        )}
      </div>

      {preview && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">
            {preview.length} rows ready to import
          </p>
          <div className="overflow-x-auto max-h-52 rounded border border-gray-200">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {COLS.map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-500 border-b">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {COLS.map((k) => (
                      <td key={k} className="px-2 py-1 truncate max-w-xs">
                        {String(row[k] ?? '')}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.length > 50 && (
            <p className="text-xs text-gray-400">Showing 50 of {preview.length} rows</p>
          )}
          <div className="flex items-center gap-3">
            <button
              onClick={() => confirmMut.mutate()}
              disabled={confirmMut.isPending}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium"
            >
              {confirmMut.isPending ? 'Importing…' : 'Confirm Import'}
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null) }}
              className="px-4 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <ImportTimer isPending={confirmMut.isPending} count={lastCount} />
          </div>
        </div>
      )}
      {!preview && <ImportTimer isPending={confirmMut.isPending} count={lastCount} />}
    </div>
  )
}

// ── Import Progress ───────────────────────────────────────────────────────────

const PROG_TEMPLATE = `code,installed_quantity,entry_date,changed_by\nCW.001,120.5,${new Date().toISOString().slice(0, 10)},John\nPI.001,300,${new Date().toISOString().slice(0, 10)},John\n`

function ImportProgress() {
  const qc = useQueryClient()
  const [file, setFile] = useState<File | null>(null)
  const [preview, setPreview] = useState<Record<string, unknown>[] | null>(null)

  const previewMut = useMutation({
    mutationFn: (f: File) => api.previewProgressImport(f),
    onSuccess: (data) => setPreview(data.rows),
    onError: (e: Error) => toast.error(e.message),
  })

  const [lastCount, setLastCount] = useState<number | null>(null)

  const confirmMut = useMutation({
    mutationFn: (rows: Record<string, unknown>[]) => api.confirmProgressImport(rows),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setLastCount(data.count)
      setFile(null)
      setPreview(null)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const COLS = ['code', 'installed_quantity', 'entry_date', 'changed_by']

  return (
    <div className="space-y-4">
      <p className="text-sm text-gray-500">
        Required columns:{' '}
        {COLS.map((c) => (
          <code key={c} className="bg-gray-100 px-1 rounded text-xs mx-0.5">
            {c}
          </code>
        ))}
        {' '}— entry_date format: YYYY-MM-DD
      </p>
      <a
        href={`data:text/csv;charset=utf-8,${encodeURIComponent(PROG_TEMPLATE)}`}
        download="progress_template.csv"
        className="inline-block text-sm text-blue-600 hover:text-blue-800 hover:underline"
      >
        ↓ Download template
      </a>
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="file"
          accept=".csv"
          onChange={(e) => {
            setFile(e.target.files?.[0] ?? null)
            setPreview(null)
          }}
          className="text-sm text-gray-600"
        />
        {file && !preview && (
          <button
            onClick={() => previewMut.mutate(file)}
            disabled={previewMut.isPending}
            className="px-4 py-1.5 bg-gray-700 text-white text-sm rounded-md hover:bg-gray-800 disabled:opacity-40"
          >
            {previewMut.isPending ? 'Parsing…' : 'Preview'}
          </button>
        )}
      </div>

      {preview && (
        <div className="space-y-3">
          <p className="text-sm font-medium text-gray-700">{preview.length} rows ready</p>
          <div className="overflow-x-auto max-h-52 rounded border border-gray-200">
            <table className="min-w-full text-xs">
              <thead className="bg-gray-50 sticky top-0">
                <tr>
                  {COLS.map((h) => (
                    <th key={h} className="px-2 py-1.5 text-left font-medium text-gray-500 border-b">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {preview.slice(0, 50).map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50">
                    {COLS.map((k) => (
                      <td key={k} className="px-2 py-1">{String(row[k] ?? '')}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="flex items-center gap-3">
            <button
              onClick={() => confirmMut.mutate()}
              disabled={confirmMut.isPending}
              className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium"
            >
              {confirmMut.isPending ? 'Importing…' : 'Confirm Import'}
            </button>
            <button
              onClick={() => { setPreview(null); setFile(null) }}
              className="px-4 py-1.5 bg-gray-100 text-gray-600 text-sm rounded-md hover:bg-gray-200"
            >
              Cancel
            </button>
            <ImportTimer isPending={confirmMut.isPending} count={lastCount} />
          </div>
        </div>
      )}
      {!preview && <ImportTimer isPending={confirmMut.isPending} count={lastCount} />}
    </div>
  )
}

// ── Audit Log ─────────────────────────────────────────────────────────────────

function AuditLog() {
  const { data: log = [], isLoading } = useQuery({
    queryKey: ['audit-log'],
    queryFn: () => api.auditLog(100),
  })

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>
  if (log.length === 0) return <p className="text-sm text-gray-400 italic">No audit entries yet.</p>

  return (
    <div className="overflow-x-auto max-h-64 rounded border border-gray-200">
      <table className="min-w-full text-xs">
        <thead className="bg-gray-50 sticky top-0">
          <tr>
            {['When', 'Who', 'Item Code', 'Previous Qty', 'New Qty', 'Entry Date'].map((h) => (
              <th key={h} className="px-2 py-1.5 text-left font-semibold text-gray-500 border-b">
                {h}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-100">
          {(log as AuditEntry[]).map((e, i) => (
            <tr key={i} className="hover:bg-gray-50">
              <td className="px-2 py-1.5 whitespace-nowrap text-gray-400">{e.changed_at}</td>
              <td className="px-2 py-1.5">{e.changed_by}</td>
              <td className="px-2 py-1.5 font-mono font-medium">{e.item_code}</td>
              <td className="px-2 py-1.5 text-right tabular-nums text-gray-400">
                {e.old_qty != null ? Number(e.old_qty).toFixed(3) : '—'}
              </td>
              <td className="px-2 py-1.5 text-right tabular-nums font-medium">
                {Number(e.new_qty).toFixed(3)}
              </td>
              <td className="px-2 py-1.5 text-gray-500">{e.entry_date}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

// ── BOQ Items Grid ────────────────────────────────────────────────────────────

const PAGE_SIZE = 50

type EditData = {
  category_id: number
  description: string
  unit: string
  budget_quantity: number
}

type NewRow = {
  category_id: number
  code: string
  description: string
  unit: string
  budget_quantity: number
}

function BoqItemsGrid() {
  const qc = useQueryClient()
  const { data: items = [], isLoading } = useQuery({
    queryKey: ['boq-items'],
    queryFn: api.boqItems,
  })
  const { data: categories = [] } = useQuery({
    queryKey: ['categories'],
    queryFn: api.categories,
  })

  const [page, setPage] = useState(1)
  const [editId, setEditId] = useState<number | null>(null)
  const [editData, setEditData] = useState<EditData>({
    category_id: 0,
    description: '',
    unit: '',
    budget_quantity: 0,
  })
  const [addMode, setAddMode] = useState(false)
  const [newRow, setNewRow] = useState<NewRow>({
    category_id: 0,
    code: '',
    description: '',
    unit: '',
    budget_quantity: 0,
  })

  const totalPages = Math.max(1, Math.ceil(items.length / PAGE_SIZE))
  const pagedItems = items.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)

  const updateMut = useMutation({
    mutationFn: ({ id, data }: { id: number; data: EditData }) =>
      api.updateBoqItem(id, data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boq-items'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setEditId(null)
      toast.success('Item updated')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const deleteMut = useMutation({
    mutationFn: (id: number) => api.deleteBoqItem(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boq-items'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      toast.success('Item deleted')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const addMut = useMutation({
    mutationFn: (data: NewRow) => api.addBoqItem(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boq-items'] })
      qc.invalidateQueries({ queryKey: ['dashboard'] })
      setAddMode(false)
      setNewRow({ category_id: 0, code: '', description: '', unit: '', budget_quantity: 0 })
      toast.success('Item added')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const startEdit = (item: BoqItem) => {
    setEditId(item.id)
    setEditData({
      category_id: item.category_id,
      description: item.description,
      unit: item.unit,
      budget_quantity: item.budget_quantity,
    })
    setAddMode(false)
  }

  const startAdd = () => {
    setAddMode(true)
    setEditId(null)
    setPage(1)
    setNewRow({
      category_id: categories[0]?.id ?? 0,
      code: '',
      description: '',
      unit: '',
      budget_quantity: 0,
    })
  }

  const inputCls = 'border border-gray-300 rounded px-2 py-1 text-sm focus:ring-1 focus:ring-blue-500 focus:outline-none w-full'

  if (isLoading) return <p className="text-sm text-gray-400">Loading…</p>

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <span className="text-sm text-gray-500">{items.length} items total</span>
        <button
          onClick={startAdd}
          disabled={addMode}
          className="px-3 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-40 font-medium"
        >
          + Add Item
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-gray-200">
        <table className="min-w-full text-sm">
          <thead className="bg-gray-50">
            <tr>
              {['Category', 'Code', 'Description', 'Unit', 'Budget Qty', ''].map((h) => (
                <th
                  key={h}
                  className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200"
                >
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100 bg-white">
            {/* New row form */}
            {addMode && page === 1 && (
              <tr className="bg-green-50">
                <td className="px-3 py-2">
                  <select
                    value={newRow.category_id}
                    onChange={(e) => setNewRow((p) => ({ ...p, category_id: Number(e.target.value) }))}
                    className={inputCls}
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </td>
                <td className="px-3 py-2">
                  <input
                    value={newRow.code}
                    onChange={(e) => setNewRow((p) => ({ ...p, code: e.target.value }))}
                    placeholder="CODE.001"
                    className={`${inputCls} font-mono`}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={newRow.description}
                    onChange={(e) => setNewRow((p) => ({ ...p, description: e.target.value }))}
                    placeholder="Description"
                    className={inputCls}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    value={newRow.unit}
                    onChange={(e) => setNewRow((p) => ({ ...p, unit: e.target.value }))}
                    placeholder="m2"
                    className={inputCls}
                  />
                </td>
                <td className="px-3 py-2">
                  <input
                    type="number"
                    value={newRow.budget_quantity}
                    onChange={(e) =>
                      setNewRow((p) => ({ ...p, budget_quantity: parseFloat(e.target.value) || 0 }))
                    }
                    className={`${inputCls} text-right`}
                  />
                </td>
                <td className="px-3 py-2">
                  <div className="flex gap-1">
                    <button
                      onClick={() => addMut.mutate(newRow)}
                      disabled={addMut.isPending || !newRow.code.trim()}
                      className="px-2 py-1 bg-green-600 text-white text-xs rounded hover:bg-green-700 disabled:opacity-40"
                    >
                      {addMut.isPending ? '…' : 'Save'}
                    </button>
                    <button
                      onClick={() => setAddMode(false)}
                      className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
                    >
                      Cancel
                    </button>
                  </div>
                </td>
              </tr>
            )}

            {/* Existing items (current page) */}
            {pagedItems.map((item) => {
              const isEditing = editId === item.id
              return (
                <tr key={item.id} className={isEditing ? 'bg-amber-50' : 'hover:bg-gray-50'}>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <select
                        value={editData.category_id}
                        onChange={(e) =>
                          setEditData((p) => ({ ...p, category_id: Number(e.target.value) }))
                        }
                        className={inputCls}
                      >
                        {categories.map((c) => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-gray-600">{item.category}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 font-mono font-semibold text-gray-800">
                    {item.code}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        value={editData.description}
                        onChange={(e) => setEditData((p) => ({ ...p, description: e.target.value }))}
                        className={inputCls}
                      />
                    ) : (
                      <span className="text-gray-700">{item.description}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <input
                        value={editData.unit}
                        onChange={(e) => setEditData((p) => ({ ...p, unit: e.target.value }))}
                        className={`${inputCls} w-20`}
                      />
                    ) : (
                      <span className="text-gray-500">{item.unit}</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right">
                    {isEditing ? (
                      <input
                        type="number"
                        value={editData.budget_quantity}
                        onChange={(e) =>
                          setEditData((p) => ({
                            ...p,
                            budget_quantity: parseFloat(e.target.value) || 0,
                          }))
                        }
                        className={`${inputCls} w-28 text-right`}
                      />
                    ) : (
                      <span className="tabular-nums">{item.budget_quantity.toFixed(3)}</span>
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {isEditing ? (
                      <div className="flex gap-1">
                        <button
                          onClick={() => updateMut.mutate({ id: item.id, data: editData })}
                          disabled={updateMut.isPending}
                          className="px-2 py-1 bg-blue-600 text-white text-xs rounded hover:bg-blue-700 disabled:opacity-40"
                        >
                          {updateMut.isPending ? '…' : 'Save'}
                        </button>
                        <button
                          onClick={() => setEditId(null)}
                          className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
                        >
                          Cancel
                        </button>
                      </div>
                    ) : (
                      <div className="flex gap-1">
                        <button
                          onClick={() => startEdit(item)}
                          className="px-2 py-1 bg-gray-100 text-gray-600 text-xs rounded hover:bg-gray-200"
                        >
                          Edit
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Delete "${item.code}"? This will also delete all progress entries for this item.`)) {
                              deleteMut.mutate(item.id)
                            }
                          }}
                          className="px-2 py-1 bg-red-50 text-red-600 text-xs rounded hover:bg-red-100"
                        >
                          Delete
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
        {items.length === 0 && !addMode && (
          <div className="text-center py-10 text-gray-400 text-sm">
            No items yet. Click "+ Add Item" to get started.
          </div>
        )}
      </div>

      {/* Pagination controls */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between pt-1">
          <span className="text-xs text-gray-500">
            Page {page} of {totalPages} &mdash; {items.length} items
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={() => { setPage(1); setEditId(null) }}
              disabled={page === 1}
              className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              «
            </button>
            <button
              onClick={() => { setPage((p) => p - 1); setEditId(null) }}
              disabled={page === 1}
              className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              ‹ Prev
            </button>
            {Array.from({ length: totalPages }, (_, i) => i + 1)
              .filter((p) => p === 1 || p === totalPages || Math.abs(p - page) <= 2)
              .reduce<(number | '…')[]>((acc, p, idx, arr) => {
                if (idx > 0 && p - (arr[idx - 1] as number) > 1) acc.push('…')
                acc.push(p)
                return acc
              }, [])
              .map((p, i) =>
                p === '…' ? (
                  <span key={`ellipsis-${i}`} className="px-1 text-xs text-gray-400">…</span>
                ) : (
                  <button
                    key={p}
                    onClick={() => { setPage(p as number); setEditId(null) }}
                    className={`px-2.5 py-1 text-xs rounded border font-medium ${
                      page === p
                        ? 'bg-blue-600 text-white border-blue-600'
                        : 'bg-white text-gray-600 border-gray-200 hover:bg-gray-50'
                    }`}
                  >
                    {p}
                  </button>
                )
              )}
            <button
              onClick={() => { setPage((p) => p + 1); setEditId(null) }}
              disabled={page === totalPages}
              className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              Next ›
            </button>
            <button
              onClick={() => { setPage(totalPages); setEditId(null) }}
              disabled={page === totalPages}
              className="px-2 py-1 text-xs rounded border border-gray-200 bg-white text-gray-600 hover:bg-gray-50 disabled:opacity-40"
            >
              »
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

// ── Budget Page ────────────────────────────────────────────────────────────────

export default function Budget() {
  return (
    <div className="space-y-3 max-w-5xl">
      <Section title="📁 Manage Categories">
        <Categories />
      </Section>
      <Section title="📥 Import BOQ from CSV">
        <ImportBoq />
      </Section>
      <Section title="📥 Import Progress from CSV">
        <ImportProgress />
      </Section>
      <Section title="📜 Audit Log">
        <AuditLog />
      </Section>
      <Section title="🗂️ BOQ Items Grid">
        <BoqItemsGrid />
      </Section>
    </div>
  )
}
