'use client'

import { useSyncExternalStore } from 'react'

import { DEFAULT_THEME, getDocumentTheme, THEME_CHANGE_EVENT, type AppTheme } from '@/lib/theme'

function subscribeToDocumentTheme(onStoreChange: () => void) {
  const root = document.documentElement
  const observer = new MutationObserver(onStoreChange)
  observer.observe(root, {
    attributes: true,
    attributeFilter: ['data-theme'],
  })
  window.addEventListener(THEME_CHANGE_EVENT, onStoreChange)
  return () => {
    observer.disconnect()
    window.removeEventListener(THEME_CHANGE_EVENT, onStoreChange)
  }
}

function getDocumentThemeSnapshot(): AppTheme {
  return getDocumentTheme()
}

function getServerThemeSnapshot(): AppTheme {
  return DEFAULT_THEME
}

export function useAppTheme(): AppTheme {
  return useSyncExternalStore(
    subscribeToDocumentTheme,
    getDocumentThemeSnapshot,
    getServerThemeSnapshot,
  )
}
