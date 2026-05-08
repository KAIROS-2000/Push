import Link from 'next/link'
import type { ReactNode } from 'react'

type AdminArea = 'admin' | 'superadmin'
type AdminSection =
  | 'telemetry'
  | 'users'
  | 'messages'
  | 'support'
  | 'teacher-requests'
  | 'admins'
  | 'lessons'
  | 'modules'
  | 'logs'
  | 'media'
  | 'useful'

interface NavItem {
  key: AdminSection
  href: string
  label: string
  description: string
}

const NAV_ITEMS: Record<AdminArea, NavItem[]> = {
  admin: [
    {
      key: 'telemetry',
      href: '/admin/telemetry',
      label: 'Телеметрия',
      description: 'Нагрузка и прогресс',
    },
    {
      key: 'users',
      href: '/admin/users',
      label: 'Пользователи',
      description: 'Поиск и блокировка',
    },
    {
      key: 'messages',
      href: '/admin/messages',
      label: 'Сообщения',
      description: 'Связь с учителями и пользователями',
    },
    {
      key: 'support',
      href: '/admin/support',
      label: 'Поддержка',
      description: 'Тикеты из анкеты и чаты',
    },
    {
      key: 'teacher-requests',
      href: '/admin/teacher-requests',
      label: 'Заявки учителей',
      description: 'Подтверждение доступа',
    },
    {
      key: 'lessons',
      href: '/admin/lessons',
      label: 'Уроки',
      description: 'Конструктор уроков',
    },
    {
      key: 'modules',
      href: '/admin/modules',
      label: 'Модули',
      description: 'Публикация и каталог',
    },
    {
      key: 'media',
      href: '/admin/media',
      label: 'Картинки',
      description: 'Обложки заданий',
    },
    {
      key: 'useful',
      href: '/admin/useful',
      label: 'Подборка',
      description: 'Полезные задания',
    },
    {
      key: 'logs',
      href: '/admin/logs',
      label: 'Логи',
      description: 'Журнал действий',
    },
  ],
  superadmin: [
    {
      key: 'telemetry',
      href: '/superadmin/telemetry',
      label: 'Телеметрия',
      description: 'Нагрузка и прогресс',
    },
    {
      key: 'users',
      href: '/superadmin/users',
      label: 'Пользователи',
      description: 'Ученики и учителя',
    },
    {
      key: 'messages',
      href: '/superadmin/messages',
      label: 'Сообщения',
      description: 'Связь с учителями и пользователями',
    },
    {
      key: 'support',
      href: '/superadmin/support',
      label: 'Поддержка',
      description: 'Тикеты из анкеты и чаты',
    },
    {
      key: 'teacher-requests',
      href: '/superadmin/teacher-requests',
      label: 'Заявки учителей',
      description: 'Подтверждение доступа',
    },
    {
      key: 'admins',
      href: '/superadmin/admins',
      label: 'Админы',
      description: 'Создание и доступ',
    },
    {
      key: 'lessons',
      href: '/superadmin/lessons',
      label: 'Уроки',
      description: 'Конструктор уроков',
    },
    {
      key: 'modules',
      href: '/superadmin/modules',
      label: 'Модули',
      description: 'Публикация и каталог',
    },
    {
      key: 'media',
      href: '/superadmin/media',
      label: 'Картинки',
      description: 'Обложки заданий',
    },
    {
      key: 'useful',
      href: '/superadmin/useful',
      label: 'Подборка',
      description: 'Полезные задания',
    },
    {
      key: 'logs',
      href: '/superadmin/logs',
      label: 'Логи',
      description: 'Журнал действий',
    },
  ],
}

function NavLinks({
  items,
  section,
  compact = false,
}: {
  items: NavItem[]
  section: AdminSection
  compact?: boolean
}) {
  return (
    <>
      {items.map((item) => {
        const isActive = item.key === section
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={isActive ? 'page' : undefined}
            className={`admin-area__nav-link ${isActive ? 'admin-area__nav-link--active' : ''} ${
              compact ? 'admin-area__nav-link--compact' : ''
            }`}
          >
            <span className="admin-area__nav-label">{item.label}</span>
            <span className="admin-area__nav-description">{item.description}</span>
          </Link>
        )
      })}
    </>
  )
}

export function AdminAreaShell({
  area,
  section,
  children,
}: {
  area: AdminArea
  section: AdminSection
  children: ReactNode
}) {
  const items = NAV_ITEMS[area]

  return (
    <main className="brand-admin-shell">
      <div className="page-shell mx-auto w-full max-w-[96rem] space-y-6">
        <div className="admin-area__mobile-nav codequest-card">
          <NavLinks items={items} section={section} compact />
        </div>

        <div className="admin-area__layout">
          <aside className="admin-area__sidebar codequest-card">
            <div className="admin-area__sidebar-shell">
              <div>
                <p className="brand-eyebrow">Navigation</p>
                <h2 className="mt-3 text-2xl font-black text-slate-900">
                  {area === 'superadmin' ? 'Суперадмин-модули' : 'Админ-модули'}
                </h2>
                <p className="mt-3 text-sm leading-7 text-slate-500">
                  Каждая зона вынесена в отдельный экран, чтобы поиск, контент и аудит не смешивались в одном полотне.
                </p>
              </div>
              <nav className="admin-area__sidebar-nav">
                <NavLinks items={items} section={section} />
              </nav>
            </div>
          </aside>

          <div className="space-y-6">{children}</div>
        </div>
      </div>
    </main>
  )
}
