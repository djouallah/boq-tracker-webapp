export type Role = 'progress_entry' | 'budget' | 'admin'

export interface Category {
  id: number
  name: string
}

export interface BoqItem {
  id: number
  category: string
  category_id: number
  code: string
  description: string
  unit: string
  budget_quantity: number
}

export interface DashboardRow {
  id: number
  category: string
  code: string
  description: string
  unit: string
  budget_quantity: number
  installed_quantity: number
  entry_date: string | null
}

export interface HistoryEntry {
  entry_date: string
  installed_quantity: number
  changed_by: string
  changed_at: string
}

export interface AuditEntry {
  changed_at: string
  changed_by: string
  item_code: string
  old_qty: number | null
  new_qty: number
  entry_date: string
}

export interface ProgressSave {
  boq_item_id: number
  installed_quantity: number
  entry_date: string
  changed_by: string
}

export interface UserRole {
  username: string
  role: Role
}
