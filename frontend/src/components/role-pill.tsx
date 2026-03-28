import { UserRole } from '@/types'

const labelMap: Record<UserRole, string> = {
  student: 'Ученик',
  teacher: 'Учитель',
  admin: 'Админ',
  superadmin: 'Суперадмин',
}

const colorMap: Record<UserRole, string> = {
  student: 'bg-sky-100 text-sky-700',
  teacher: 'bg-emerald-100 text-emerald-700',
  admin: 'bg-violet-100 text-violet-700',
  superadmin: 'bg-rose-100 text-rose-700',
}

export function RolePill({ role }: { role: UserRole }) {
  return <span className={`rounded-full px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${colorMap[role]}`}>{labelMap[role]}</span>
}
