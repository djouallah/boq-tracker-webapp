import type { Category, BoqItem, DashboardRow, HistoryEntry, AuditEntry, ProgressSave, Role, UserRole } from './types'

const BASE = '/api'

async function get<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path)
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json()
}

async function postEmpty<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { method: 'POST' })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json()
}

async function post<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json()
}

async function put<T>(path: string, body: unknown): Promise<T> {
  const r = await fetch(BASE + path, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json()
}

async function del<T>(path: string): Promise<T> {
  const r = await fetch(BASE + path, { method: 'DELETE' })
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
}

async function upload<T>(path: string, file: File): Promise<T> {
  const form = new FormData()
  form.append('file', file)
  const r = await fetch(BASE + path, { method: 'POST', body: form })
  if (!r.ok) {
    const msg = await r.text()
    throw new Error(msg || `HTTP ${r.status}`)
  }
  return r.json()
}

export const api = {
  dbStatus: (): Promise<{
    backend: string; sqlite_path: string;
    pg_host: string | null; pg_user: string | null;
    tenant_id: string | null; tenant_domain: string | null; client_id: string | null;
    connected: boolean; error: string | null;
    is_local: boolean; has_admin: boolean;
  }> => get('/db-status'),
  saveDbConfig: (body: {
    backend: string; sqlite_path?: string;
    pg_host?: string; pg_database?: string; pg_user?: string;
    tenant_id?: string; tenant_domain?: string; client_id?: string; client_secret?: string;
  }): Promise<{ ok: boolean; connected: boolean; error?: string }> =>
    post('/db-config', body),

  saveTenantDomain: (tenant_domain: string): Promise<{ ok: boolean }> =>
    post('/tenant-domain', { tenant_domain }),

  authStatus: (): Promise<{ authenticated: boolean; user: string | null; expired: boolean; just_completed?: boolean; pending?: boolean }> =>
    get('/auth/status'),
  authLogout: (): Promise<{ ok: boolean }> =>
    del('/auth/token'),
  firstAdmin: (body: { username: string }): Promise<{ ok: boolean }> =>
    post('/first-admin', body),
  provisionPgUser: (body: { email: string }): Promise<{ ok: boolean }> =>
    post('/provision-pg-user', body),

  me: (): Promise<{ user: string; role: Role | null }> => get('/me'),

  dashboard: (params: {
    page?: number; category?: string; search?: string; progress_only?: boolean
  } = {}): Promise<{ rows: DashboardRow[]; total: number; page: number; page_size: number }> => {
    const q = new URLSearchParams()
    if (params.page) q.set('page', String(params.page))
    if (params.category) q.set('category', params.category)
    if (params.search) q.set('search', params.search)
    if (params.progress_only) q.set('progress_only', 'true')
    return get(`/dashboard?${q}`)
  },

  categories: (): Promise<Category[]> => get('/categories'),
  addCategory: (name: string): Promise<Category> => post('/categories', { name }),
  deleteCategory: (id: number) => del<{ ok: boolean }>(`/categories/${id}`),

  boqItems: (): Promise<BoqItem[]> => get('/boq-items'),
  addBoqItem: (data: Omit<BoqItem, 'id' | 'category'>) =>
    post<{ ok: boolean }>('/boq-items', data),
  updateBoqItem: (
    id: number,
    data: { category_id: number; description: string; unit: string; budget_quantity: number }
  ) => put<{ ok: boolean }>(`/boq-items/${id}`, data),
  deleteBoqItem: (id: number) => del<{ ok: boolean }>(`/boq-items/${id}`),

  saveProgress: (entries: ProgressSave[]): Promise<{ saved: number }> =>
    post('/progress', entries),
  history: (itemId: number): Promise<HistoryEntry[]> =>
    get(`/progress/${itemId}/history`),

  auditLog: (limit = 100): Promise<AuditEntry[]> =>
    get(`/audit-log?limit=${limit}`),

  previewBoqImport: (file: File): Promise<{ rows: Record<string, unknown>[] }> =>
    upload('/import/boq/preview', file),
  confirmBoqImport: (): Promise<{ count: number }> =>
    postEmpty('/import/boq/confirm'),

  previewProgressImport: (file: File): Promise<{ rows: Record<string, unknown>[] }> =>
    upload('/import/progress/preview', file),
  confirmProgressImport: (rows: Record<string, unknown>[]): Promise<{ count: number }> =>
    post('/import/progress/confirm', rows),

  roles: (): Promise<UserRole[]> => get('/roles'),
  setRole: (username: string, role: Role): Promise<{ ok: boolean }> =>
    post('/roles', { username, role }),
  deleteRole: (username: string) => del<{ ok: boolean }>(`/roles/${encodeURIComponent(username)}`),
}
