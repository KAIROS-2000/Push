'use client'

import { useEffect, useLayoutEffect } from 'react'
import { applyTheme, DEFAULT_THEME, getStoredTheme } from '@/lib/theme'

export function ThemeHydrator() {
  useLayoutEffect(() => {
    applyTheme(getStoredTheme() || DEFAULT_THEME)
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

  return null
}
