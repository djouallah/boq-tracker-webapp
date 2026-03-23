import { useState } from 'react'
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import toast from 'react-hot-toast'
import { api } from '../api'
import type { Role, UserRole } from '../types'

// ── Microsoft Sign-In ──────────────────────────────────────────────────────────

export function MicrosoftSignIn({ compact = false }: { compact?: boolean }) {
  const qc = useQueryClient()

  const { data: authSt } = useQuery({
    queryKey: ['auth-status'],
    queryFn: api.authStatus,
    refetchInterval: 30_000,
  })

  const logoutMut = useMutation({
    mutationFn: api.authLogout,
    onSuccess: () => { qc.invalidateQueries(); toast.success('Signed out') },
  })

  const loginMut = useMutation({
    mutationFn: (): Promise<{ ok: boolean; user: string }> =>
      fetch('/api/auth/login', { method: 'POST' }).then(async r => {
        if (!r.ok) throw new Error(await r.text())
        return r.json()
      }),
    onSuccess: (res) => {
      qc.invalidateQueries()
      toast.success(`Signed in as ${res.user}`)
      setTimeout(() => window.location.reload(), 800)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  if (authSt?.authenticated) {
    return (
      <div className={`flex items-center gap-3 ${compact ? '' : 'p-3 bg-green-50 rounded-lg border border-green-200'}`}>
        <span className="inline-block w-2 h-2 rounded-full bg-green-500" />
        <span className="text-sm text-green-800 font-mono flex-1">{authSt.user}</span>
        <button onClick={() => loginMut.mutate()} disabled={loginMut.isPending} className="text-xs text-blue-600 hover:underline disabled:opacity-40">
          {loginMut.isPending ? 'Opening browser…' : 'Switch account'}
        </button>
        <button onClick={() => logoutMut.mutate()} className="text-xs text-gray-500 hover:text-red-600 underline">Sign out</button>
      </div>
    )
  }

  return (
    <div className={compact ? '' : 'space-y-2'}>
      {!compact && (
        <p className="text-xs text-gray-500">
          Pick any of your Microsoft accounts — a browser window opens with an account picker.
          {authSt?.expired && <span className="text-amber-600 ml-1"> Your previous session expired.</span>}
        </p>
      )}
      <button
        onClick={() => loginMut.mutate()}
        disabled={loginMut.isPending}
        className="flex items-center gap-2 px-4 py-2 bg-[#0078d4] text-white text-sm rounded-md hover:bg-[#106ebe] disabled:opacity-60 font-medium"
      >
        <svg width="16" height="16" viewBox="0 0 21 21" fill="white">
          <rect x="1" y="1" width="9" height="9" />
          <rect x="11" y="1" width="9" height="9" />
          <rect x="1" y="11" width="9" height="9" />
          <rect x="11" y="11" width="9" height="9" />
        </svg>
        {loginMut.isPending ? 'Waiting for browser sign-in…' : 'Sign in with Microsoft'}
      </button>
    </div>
  )
}

// ── DB Config ─────────────────────────────────────────────────────────────────

function DbConfig() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['db-status'],
    queryFn: api.dbStatus,
    retry: false,
  })

  const [backend, setBackend] = useState<'sqlite' | 'postgresql'>('postgresql')
  const [sqlitePath, setSqlitePath] = useState('boq_tracker.db')
  const [pgHost, setPgHost] = useState('')

  const [synced, setSynced] = useState(false)
  if (status && !synced) {
    setBackend(status.backend as 'sqlite' | 'postgresql')
    setSqlitePath(status.sqlite_path || 'boq_tracker.db')
    setPgHost(status.pg_host || '')
    setSynced(true)
  }

  const saveMut = useMutation({
    mutationFn: () => api.saveDbConfig(
      backend === 'sqlite'
        ? { backend, sqlite_path: sqlitePath }
        : { backend, pg_host: pgHost }
    ),
    onSuccess: (res) => {
      qc.invalidateQueries()
      if (res.connected) toast.success('Configuration saved — reconnected')
      else toast.error(`Saved but connection failed: ${res.error}`)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const dot = isLoading ? 'bg-gray-300' : status?.connected ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className="space-y-4">
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input
            type="radio"
            name="backend"
            value="sqlite"
            checked={backend === 'sqlite'}
            onChange={() => setBackend('sqlite')}
            className="accent-blue-600"
          />
          SQLite (local file)
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input
            type="radio"
            name="backend"
            value="postgresql"
            checked={backend === 'postgresql'}
            onChange={() => setBackend('postgresql')}
            className="accent-blue-600"
          />
          PostgreSQL (Azure AD)
        </label>
      </div>

      {backend === 'sqlite' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">SQLite file path</label>
          <input
            value={sqlitePath}
            onChange={(e) => setSqlitePath(e.target.value)}
            placeholder="boq_tracker.db"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-80 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
      )}

      {backend === 'postgresql' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">PostgreSQL server</label>
            <input
              value={pgHost}
              onChange={(e) => setPgHost(e.target.value)}
              placeholder="myserver.postgres.database.azure.com"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-96 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
            />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="text-sm text-gray-600">
          {isLoading ? 'Checking…' : status?.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <button
        onClick={() => saveMut.mutate()}
        disabled={saveMut.isPending}
        className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium"
      >
        {saveMut.isPending ? 'Saving…' : 'Save & reconnect'}
      </button>
    </div>
  )
}

// ── User Roles ────────────────────────────────────────────────────────────────

const ROLE_LABELS: Record<Role, string> = {
  progress_entry: 'Progress Entry',
  budget: 'Budget',
  admin: 'Admin',
}

const ROLE_COLORS: Record<Role, string> = {
  progress_entry: 'bg-gray-100 text-gray-700',
  budget: 'bg-blue-100 text-blue-700',
  admin: 'bg-purple-100 text-purple-700',
}

function UserRoles({ isAdmin = false, currentUser = '' }: { isAdmin?: boolean; currentUser?: string }) {
  const qc = useQueryClient()
  const { data: roles = [], isLoading } = useQuery({
    queryKey: ['roles'],
    queryFn: api.roles,
  })
  const visibleRoles = isAdmin ? (roles as UserRole[]) : (roles as UserRole[]).filter(r => r.username === currentUser)

  const [username, setUsername] = useState('')
  const [role, setRole] = useState<Role>('progress_entry')

  const setMut = useMutation({
    mutationFn: () => api.setRole(username.trim(), role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      setUsername('')
      toast.success('Role assigned')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const delMut = useMutation({
    mutationFn: (u: string) => api.deleteRole(u),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['roles'] })
      toast.success('Role removed')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-4">
      {/* Add / update form — admin only */}
      {isAdmin && <div className="flex gap-2 flex-wrap items-end">
        <div className="flex-1 min-w-48">
          <label className="block text-xs text-gray-500 mb-1">Username</label>
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && username.trim() && setMut.mutate()}
            placeholder="john.doe@example.com"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-full focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
        </div>
        <div>
          <label className="block text-xs text-gray-500 mb-1">Role</label>
          <select
            value={role}
            onChange={(e) => setRole(e.target.value as Role)}
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
          >
            {(Object.keys(ROLE_LABELS) as Role[]).map((r) => (
              <option key={r} value={r}>{ROLE_LABELS[r]}</option>
            ))}
          </select>
        </div>
        <button
          onClick={() => setMut.mutate()}
          disabled={!username.trim() || setMut.isPending || !isAdmin}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium"
        >
          {setMut.isPending ? 'Saving…' : 'Assign'}
        </button>
      </div>}

      {/* Current roles table */}
      {isLoading ? (
        <p className="text-sm text-gray-400">Loading…</p>
      ) : visibleRoles.length === 0 ? (
        <p className="text-sm text-gray-400 italic">No users assigned yet.</p>
      ) : (
        <div className="rounded-lg border border-gray-200 overflow-hidden">
          <table className="min-w-full text-sm">
            <thead className="bg-gray-50">
              <tr>
                {['Username', 'Role', ...(isAdmin ? [''] : [])].map((h) => (
                  <th key={h} className="px-3 py-2 text-left text-xs font-semibold text-gray-500 uppercase tracking-wider border-b border-gray-200">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white">
              {visibleRoles.map((r) => (
                <tr key={r.username} className="hover:bg-gray-50">
                  <td className="px-3 py-2 font-mono text-gray-700">{r.username}</td>
                  <td className="px-3 py-2">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${ROLE_COLORS[r.role]}`}>
                      {ROLE_LABELS[r.role]}
                    </span>
                  </td>
                  {isAdmin && <td className="px-3 py-2 text-right">
                    <button
                      onClick={() => {
                        if (confirm(`Remove role for "${r.username}"?`)) delMut.mutate(r.username)
                      }}
                      className="px-2 py-1 bg-red-50 text-red-600 text-xs rounded hover:bg-red-100"
                    >
                      Remove
                    </button>
                  </td>}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// ── Provision PostgreSQL User ──────────────────────────────────────────────────

export function ProvisionPgUser({ isAdmin = false }: { isAdmin?: boolean }) {
  const [email, setEmail] = useState('')

  const mut = useMutation({
    mutationFn: () => api.provisionPgUser({ email }),
    onSuccess: () => {
      toast.success(`${email} provisioned — they can now connect with their Azure AD credentials.`)
      setEmail('')
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3">
      <p className="text-xs text-gray-500">
        You must be set as the <strong>Entra Admin</strong> on the PostgreSQL server in Azure Portal.
        Your current Azure AD identity is used — no extra credentials needed.
      </p>
      <div>
        <label className="block text-xs text-gray-500 mb-1">New user email (Azure AD)</label>
        <div className="flex gap-2">
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && email.trim() && mut.mutate()}
            placeholder="newuser@domain.com"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-80 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            onClick={() => mut.mutate()}
            disabled={!email.trim() || mut.isPending || !isAdmin}
            className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium whitespace-nowrap"
          >
            {mut.isPending ? 'Provisioning…' : 'Grant access'}
          </button>
        </div>
        <p className="text-xs text-gray-400 mt-1">
          Creates the Azure AD principal in PostgreSQL and grants read/write on all app tables.
        </p>
      </div>
    </div>
  )
}

// ── Setup Page ────────────────────────────────────────────────────────────────

function SignInSection() {
  const qc = useQueryClient()
  const { data: status } = useQuery({ queryKey: ['db-status'], queryFn: api.dbStatus, retry: false })
  const [tenantDomain, setTenantDomain] = useState('')
  const [synced, setSynced] = useState(false)
  if (status && !synced) {
    setTenantDomain(status.tenant_domain || '')
    setSynced(true)
  }
  const saveMut = useMutation({
    mutationFn: () => api.saveTenantDomain(tenantDomain),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['db-status'] }),
  })

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Tenant domain</label>
        <div className="flex gap-2 items-center">
          <input
            value={tenantDomain}
            onChange={(e) => setTenantDomain(e.target.value)}
            placeholder="yourorg.onmicrosoft.com (leave blank to use account domain)"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-96 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
          />
          <button
            onClick={() => saveMut.mutate()}
            disabled={saveMut.isPending || tenantDomain === (status?.tenant_domain ?? '')}
            className="px-3 py-1.5 bg-gray-100 text-gray-700 text-xs rounded-md hover:bg-gray-200 border border-gray-300 font-medium disabled:opacity-40"
          >
            {saveMut.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
      <MicrosoftSignIn />
    </div>
  )
}

export default function Setup() {
  const { data: me } = useQuery({ queryKey: ['me'], queryFn: api.me, retry: false })
  const isAdmin = me?.role === 'admin'

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Sign in with Microsoft</h2>
        <p className="text-sm text-gray-500 mb-4">
          Pick any of your Microsoft accounts to use for the PostgreSQL connection.
        </p>
        <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
          <SignInSection />
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Database Configuration</h2>
        <p className="text-sm text-gray-500 mb-4">Configure the database backend.</p>
        <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
          <DbConfig />
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">Provision Database User</h2>
        <p className="text-sm text-gray-500 mb-4">
          Add an Azure AD user to the PostgreSQL server so they can connect with their own credentials.
        </p>
        <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
          <ProvisionPgUser isAdmin={isAdmin} />
        </div>
      </div>

      <div>
        <h2 className="text-base font-semibold text-gray-800 mb-1">User Roles</h2>
        <p className="text-sm text-gray-500 mb-4">
          Assign roles to users. Usernames must match exactly what the app detects from request headers.
        </p>
        <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
          <UserRoles isAdmin={isAdmin} currentUser={me?.user ?? ''} />
        </div>
      </div>
    </div>
  )
}
