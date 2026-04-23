import { UserRole } from '@/types'

const labelMap: Record<UserRole, string> = {
  student: 'Ученик',
  teacher: 'Учитель',
  admin: 'Админ',
  superadmin: 'Суперадмин',
}

const colorMap: Record<UserRole, string> = {
  student: 'border-sky-200 bg-sky-50 text-sky-700',
  teacher: 'border-emerald-200 bg-emerald-50 text-emerald-700',
  admin: 'border-violet-200 bg-violet-50 text-violet-700',
  superadmin: 'border-rose-200 bg-rose-50 text-rose-700',
}

export function RolePill({ role }: { role: UserRole }) {
  return (
    <span
      className={`inline-flex rounded-full border px-3 py-1 text-xs font-bold uppercase tracking-[0.2em] ${colorMap[role]}`}
    >
      {labelMap[role]}
    </span>
  )
}
