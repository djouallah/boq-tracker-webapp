import { useState } from 'react'
import { QueryClient, QueryClientProvider, useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { Toaster } from 'react-hot-toast'
import toast from 'react-hot-toast'
import Progress from './pages/Progress'
import Budget from './pages/Budget'
import Setup, { ProvisionPgUser, MicrosoftSignIn } from './pages/Setup'
import { api } from './api'
import type { Role } from './types'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
})

type Tab = 'progress' | 'budget' | 'setup'

// ── Inline DB config shown on the Access Denied screen ────────────────────────

function DbConfigInline() {
  const qc = useQueryClient()
  const { data: status, isLoading } = useQuery({
    queryKey: ['db-status'],
    queryFn: api.dbStatus,
    retry: false,
  })

  const [backend, setBackend] = useState<'sqlite' | 'postgresql'>('postgresql')
  const [sqlitePath, setSqlitePath] = useState('boq_tracker.db')
  const [pgHost, setPgHost] = useState('')
  const [tenantDomain, setTenantDomain] = useState('')
  const [synced, setSynced] = useState(false)
  if (status && !synced) {
    setBackend(status.backend as 'sqlite' | 'postgresql')
    setSqlitePath(status.sqlite_path || 'boq_tracker.db')
    setPgHost(status.pg_host || '')
    setTenantDomain(status.tenant_domain || '')
    setSynced(true)
  }

  const saveMut = useMutation({
    mutationFn: () => api.saveDbConfig(
      backend === 'sqlite'
        ? { backend, sqlite_path: sqlitePath }
        : { backend, pg_host: pgHost, tenant_domain: tenantDomain }
    ),
    onSuccess: (res) => {
      qc.invalidateQueries({ queryKey: ['db-status'] })
      qc.invalidateQueries({ queryKey: ['me'] })
      if (res.connected) toast.success('Reconnected — reloading…', { duration: 1500 })
      else toast.error(`Connection failed: ${res.error}`)
      if (res.connected) setTimeout(() => window.location.reload(), 1600)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  const dot = isLoading ? 'bg-gray-300' : status?.connected ? 'bg-green-500' : 'bg-red-500'

  return (
    <div className="space-y-4">
      <div className="flex gap-6">
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input type="radio" name="db-inline" value="sqlite"
            checked={backend === 'sqlite'} onChange={() => setBackend('sqlite')}
            className="accent-blue-600" />
          SQLite (local file)
        </label>
        <label className="flex items-center gap-2 cursor-pointer text-sm text-gray-700">
          <input type="radio" name="db-inline" value="postgresql"
            checked={backend === 'postgresql'} onChange={() => setBackend('postgresql')}
            className="accent-blue-600" />
          PostgreSQL (Azure AD)
        </label>
      </div>

      {backend === 'sqlite' && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">SQLite file path</label>
          <input value={sqlitePath} onChange={(e) => setSqlitePath(e.target.value)}
            placeholder="boq_tracker.db"
            className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-80 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none" />
        </div>
      )}

      {backend === 'postgresql' && (
        <div className="space-y-3">
          <div>
            <label className="block text-xs text-gray-500 mb-1">Tenant domain</label>
            <input value={tenantDomain} onChange={(e) => setTenantDomain(e.target.value)}
              placeholder="yourorg.onmicrosoft.com"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-96 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">PostgreSQL server</label>
            <input value={pgHost} onChange={(e) => setPgHost(e.target.value)}
              placeholder="myserver.postgres.database.azure.com"
              className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-96 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none" />
          </div>
        </div>
      )}

      <div className="flex items-center gap-2">
        <span className={`inline-block w-2.5 h-2.5 rounded-full ${dot}`} />
        <span className="text-sm text-gray-600">
          {isLoading ? 'Checking…' : status?.connected ? 'Connected' : 'Not connected'}
        </span>
      </div>

      <div className="flex items-center gap-3">
        <button onClick={() => saveMut.mutate()} disabled={saveMut.isPending}
          className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded-md hover:bg-blue-700 disabled:opacity-40 font-medium">
          {saveMut.isPending ? 'Saving…' : 'Save & reconnect'}
        </button>
      </div>
    </div>
  )
}

// ── Claim first admin ──────────────────────────────────────────────────────────

function ClaimAdminForm({ defaultUser }: { defaultUser: string }) {
  const qc = useQueryClient()
  const [username, setUsername] = useState(defaultUser)

  const mut = useMutation({
    mutationFn: () => api.firstAdmin({ username }),
    onSuccess: () => {
      toast.success('Admin created — reloading…', { duration: 1500 })
      qc.invalidateQueries({ queryKey: ['me'] })
      setTimeout(() => window.location.reload(), 1600)
    },
    onError: (e: Error) => toast.error(e.message),
  })

  return (
    <div className="space-y-3">
      <div>
        <label className="block text-xs text-gray-500 mb-1">Username</label>
        <input
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="border border-gray-300 rounded-md px-3 py-1.5 text-sm w-80 font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"
        />
      </div>
      <button
        onClick={() => mut.mutate()}
        disabled={mut.isPending || !username}
        className="px-4 py-1.5 bg-green-600 text-white text-sm rounded-md hover:bg-green-700 disabled:opacity-40 font-medium"
      >
        {mut.isPending ? 'Creating…' : 'Claim admin'}
      </button>
    </div>
  )
}

// ── Main app shell ─────────────────────────────────────────────────────────────

function AppShell() {
  const [tab, setTab] = useState<Tab>('progress')

  const { data: me, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: api.me,
    retry: false,
  })

  const { data: dbStatus } = useQuery({
    queryKey: ['db-status'],
    queryFn: api.dbStatus,
    retry: false,
  })

  const role: Role | null = me?.role ?? null

  const canProgress = role !== null
  const canBudget   = role === 'budget' || role === 'admin'
  const canSetup    = true

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <p className="text-sm text-gray-400">Loading…</p>
      </div>
    )
  }

  if (!role) {
    return (
      <div className="min-h-screen bg-gray-50">
        <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
          <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
            <h1 className="text-lg font-bold text-gray-800 tracking-tight">BOQ Tracker</h1>
          </div>
        </header>
        <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
          <div className="max-w-2xl space-y-6">
            <div className="border border-red-200 rounded-lg p-4 bg-red-50 text-sm text-red-800">
              <p className="font-semibold mb-1">Access Denied</p>
              <p>Your account <span className="font-mono font-medium">{me?.user}</span> has no role assigned. Contact an administrator to get access.</p>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-1">Sign in with Microsoft</h2>
              <p className="text-sm text-gray-500 mb-3">If the database connection is failing, sign in with the Microsoft account that has PostgreSQL access.</p>
              <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
                <MicrosoftSignIn />
              </div>
            </div>
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-1">Database Configuration</h2>
              <p className="text-sm text-gray-500 mb-4">Switch to a different database if needed.</p>
              <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
                <DbConfigInline />
              </div>
            </div>
            {dbStatus?.connected && !dbStatus.has_admin && (
              <div>
                <h2 className="text-base font-semibold text-gray-800 mb-1">Claim Admin</h2>
                <p className="text-sm text-gray-500 mb-4">No admin exists yet — claim the first admin role.</p>
                <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
                  <ClaimAdminForm defaultUser={me?.user ?? ''} />
                </div>
              </div>
            )}
            <div>
              <h2 className="text-base font-semibold text-gray-800 mb-1">Provision Database User</h2>
              <p className="text-sm text-gray-500 mb-4">Add an Azure AD user to the PostgreSQL server.</p>
              <div className="border border-gray-200 rounded-lg p-5 bg-white shadow-sm">
                <ProvisionPgUser />
              </div>
            </div>
          </div>
        </main>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200 shadow-sm sticky top-0 z-10">
        <div className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-6">
            <h1 className="text-lg font-bold text-gray-800 tracking-tight">BOQ Tracker</h1>
            <nav className="flex gap-1">
              {canProgress && (
                <button onClick={() => setTab('progress')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    tab === 'progress' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  📊 Progress
                </button>
              )}
              {canBudget && (
                <button onClick={() => setTab('budget')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    tab === 'budget' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  💰 Budget
                </button>
              )}
              {canSetup && (
                <button onClick={() => setTab('setup')}
                  className={`px-4 py-2 rounded-md text-sm font-medium transition-colors ${
                    tab === 'setup' ? 'bg-blue-600 text-white shadow-sm' : 'text-gray-600 hover:bg-gray-100'
                  }`}>
                  ⚙️ Setup
                </button>
              )}
            </nav>
          </div>
          <div className="flex items-center gap-3 text-xs text-gray-400">
            <span className={`px-2 py-0.5 rounded-full font-medium ${
              role === 'admin'  ? 'bg-purple-100 text-purple-700' :
              role === 'budget' ? 'bg-blue-100 text-blue-700' :
                                  'bg-gray-100 text-gray-600'
            }`}>
              {role}
            </span>
            <button
              onClick={() => api.authLogout().then(() => window.location.reload())}
              className="text-gray-400 hover:text-red-500 underline"
            >
              Sign out
            </button>
          </div>
        </div>
      </header>
      <main className="max-w-screen-2xl mx-auto px-4 sm:px-6 py-6">
        {tab === 'progress' && canProgress && <Progress />}
        {tab === 'budget'   && canBudget   && <Budget />}
        {tab === 'setup'    && canSetup    && <Setup />}
      </main>
    </div>
  )
}

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <Toaster position="top-right" toastOptions={{ duration: 4000, style: { fontSize: '14px' } }} />
      <AppShell />
    </QueryClientProvider>
  )
}
