'use client'

import { useEffect, useState } from 'react'

import { DEFAULT_THEME, getDocumentTheme, THEME_CHANGE_EVENT, type AppTheme } from '@/lib/theme'

export function useAppTheme() {
  const [theme, setTheme] = useState<AppTheme>(() => {
    if (typeof document === 'undefined') return DEFAULT_THEME
    return getDocumentTheme()
  })

  useEffect(() => {
    const syncTheme = () => setTheme(getDocumentTheme())

    syncTheme()

    const root = document.documentElement
    const observer = new MutationObserver(syncTheme)
    observer.observe(root, {
      attributes: true,
      attributeFilter: ['data-theme'],
    })

    window.addEventListener(THEME_CHANGE_EVENT, syncTheme)

    return () => {
      observer.disconnect()
      window.removeEventListener(THEME_CHANGE_EVENT, syncTheme)
    }
  }, [])

  return theme
}
