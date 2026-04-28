'use client'

import { useEffect, useLayoutEffect } from 'react'
import { usePathname } from 'next/navigation'
import { fetchSessionUser } from '@/lib/auth-session'
import { isAuthRoutePath, isProtectedRoutePath } from '@/lib/auth-routes'
import { getSessionSnapshot, subscribeSessionSnapshot } from '@/lib/session-store'
import {
  applyTheme,
  DEFAULT_THEME,
  getDocumentTheme,
  getStoredTheme,
  isAppTheme,
  isThemeViewTransitionRunning,
  setTheme,
} from '@/lib/theme'

const SESSION_REVALIDATION_INTERVAL_MS = 30_000

export function ThemeHydrator() {
  const pathname = usePathname()

  useLayoutEffect(() => {
    const stored = getStoredTheme()
    if (stored) {
      if (getDocumentTheme() !== stored) {
        applyTheme(stored)
      }
      return
    }
    const sessionTheme = getSessionSnapshot().user?.theme
    if (isAppTheme(sessionTheme)) {
      applyTheme(sessionTheme)
    } else {
      applyTheme(DEFAULT_THEME)
    }
  }, [])

  useEffect(() => {
    const root = document.documentElement

    const syncViewport = () => {
      const viewport = window.visualViewport
      const width = Math.round(viewport?.width ?? window.innerWidth)
      const height = Math.round(viewport?.height ?? window.innerHeight)

      root.style.setProperty('--app-vw', `${width}px`)
      root.style.setProperty('--app-vh', `${height}px`)

      if (width <= 360) {
        root.dataset.phoneLayout = 'compact'
      } else if (width <= 430) {
        root.dataset.phoneLayout = 'standard'
      } else {
        root.dataset.phoneLayout = 'wide'
      }
    }

    syncViewport()

    const viewport = window.visualViewport
    viewport?.addEventListener('resize', syncViewport)
    viewport?.addEventListener('scroll', syncViewport)
    window.addEventListener('resize', syncViewport)
    window.addEventListener('orientationchange', syncViewport)

    return () => {
      viewport?.removeEventListener('resize', syncViewport)
      viewport?.removeEventListener('scroll', syncViewport)
      window.removeEventListener('resize', syncViewport)
      window.removeEventListener('orientationchange', syncViewport)
      root.style.removeProperty('--app-vw')
      root.style.removeProperty('--app-vh')
      delete root.dataset.phoneLayout
    }
  }, [])

  useEffect(() => {
    const snapshot = getSessionSnapshot()
    const stored = getStoredTheme()
    if (stored) {
      if (getDocumentTheme() !== stored) {
        setTheme(stored, { persist: true })
      }
    } else if (snapshot.user?.theme) {
      setTheme(snapshot.user.theme)
    }

    let cancelled = false

    fetchSessionUser({ auth: 'optional' })
      .then((user) => {
        if (cancelled || !user?.theme || isThemeViewTransitionRunning()) return
        const latestStored = getStoredTheme()
        if (latestStored) {
          if (getDocumentTheme() !== latestStored) {
            setTheme(latestStored, { persist: true })
          }
          return
        }
        setTheme(user.theme)
      })
      .catch(() => undefined)

    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    const revalidateSession = () => {
      const snapshot = getSessionSnapshot()
      if (snapshot.status === 'anonymous') {
        return
      }
      void fetchSessionUser({ auth: 'optional', force: true }).catch(() => undefined)
    }

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        revalidateSession()
      }
    }

    const intervalId = window.setInterval(() => {
      if (document.visibilityState === 'visible') {
        revalidateSession()
      }
    }, SESSION_REVALIDATION_INTERVAL_MS)

    window.addEventListener('focus', revalidateSession)
    window.addEventListener('pageshow', revalidateSession)
    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', revalidateSession)
      window.removeEventListener('pageshow', revalidateSession)
      document.removeEventListener('visibilitychange', handleVisibilityChange)
    }
  }, [])

  useEffect(() => {
    return subscribeSessionSnapshot((snapshot) => {
      if (snapshot.status !== 'anonymous') {
        return
      }
      if (!pathname || isAuthRoutePath(pathname) || !isProtectedRoutePath(pathname)) {
        return
      }
      window.location.replace('/auth/login')
    })
  }, [pathname])

  useEffect(() => {
    return subscribeSessionSnapshot((snapshot) => {
      if (isThemeViewTransitionRunning()) {
        return
      }
      const stored = getStoredTheme()
      if (stored) {
        if (getDocumentTheme() !== stored) {
          applyTheme(stored)
        }
        return
      }
      if (snapshot.status !== 'authenticated' || !snapshot.user?.theme) {
        return
      }
      const t = snapshot.user.theme
      if (!isAppTheme(t)) {
        return
      }
      if (getDocumentTheme() !== t) {
        setTheme(t)
      }
    })
  }, [])

  return null
}
