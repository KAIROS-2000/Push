'use client'

import { type MouseEvent, useState } from 'react'
import { Moon, SunMedium } from 'lucide-react'

import { api } from '@/lib/api'
import { setAuthenticatedSession } from '@/lib/session-store'
import { showErrorToast } from '@/lib/toast'
import {
  getDocumentTheme,
  setThemeWithTransition,
  type AppTheme,
} from '@/lib/theme'
import { useAppTheme } from '@/hooks/use-app-theme'
import type { UserItem } from '@/types'

function nextThemeFor(currentTheme: AppTheme): AppTheme {
  return currentTheme === 'dark' ? 'light' : 'dark'
}

function getThemeTransitionOrigin(button: HTMLButtonElement) {
  const { left, top, width, height } = button.getBoundingClientRect()

  return {
    x: left + width / 2,
    y: top + height / 2,
  }
}

export function ThemeToggleButton({
  user,
  className = '',
}: {
  user?: UserItem | null
  className?: string
}) {
  const theme = useAppTheme()
  const [saving, setSaving] = useState(false)
  const [transitioning, setTransitioning] = useState(false)

  async function handleToggle(event: MouseEvent<HTMLButtonElement>) {
    if (saving || transitioning) return

    const previousTheme = getDocumentTheme()
    const nextTheme = nextThemeFor(previousTheme)
    const origin = getThemeTransitionOrigin(event.currentTarget)
    const transitionPromise = setThemeWithTransition(nextTheme, { origin })

    setTransitioning(true)

    if (!user) {
      try {
        await transitionPromise
      } finally {
        setTransitioning(false)
      }
      return
    }

    setAuthenticatedSession({ ...user, theme: nextTheme })
    setSaving(true)

    try {
      const result = await api<{ user: UserItem }>(
        '/users/me',
        {
          method: 'PATCH',
          body: JSON.stringify({ theme: nextTheme }),
        },
        'required',
      )

      setAuthenticatedSession(result.user)
      await transitionPromise

      if (result.user.theme !== nextTheme) {
        await setThemeWithTransition(result.user.theme, { origin })
      }
    } catch (error) {
      await transitionPromise
      await setThemeWithTransition(previousTheme, { origin })
      setAuthenticatedSession(user)
      showErrorToast(
        error instanceof Error
          ? error.message
          : 'Не удалось сохранить тему интерфейса.',
      )
    } finally {
      setSaving(false)
      setTransitioning(false)
    }
  }

  const isDark = theme === 'dark'
  const buttonClassName =
    `progyx-theme-toggle ${isDark ? 'progyx-theme-toggle--dark' : 'progyx-theme-toggle--light'} ${className}`.trim()

  return (
    <button
      type='button'
      aria-label={
        isDark ? 'Переключить на светлую тему' : 'Переключить на темную тему'
      }
      aria-pressed={isDark}
      aria-busy={saving || transitioning}
      className={buttonClassName}
      onClick={handleToggle}
      disabled={saving || transitioning}
    >
      <span className='progyx-theme-toggle__surface' aria-hidden='true'>
        <span className='progyx-theme-toggle__halo' />
        <span className='progyx-theme-toggle__stage'>
          <SunMedium className='progyx-theme-toggle__icon progyx-theme-toggle__icon--sun' />
          <Moon className='progyx-theme-toggle__icon progyx-theme-toggle__icon--moon' />
        </span>
      </span>
    </button>
  )
}
