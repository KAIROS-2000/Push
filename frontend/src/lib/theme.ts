export type AppTheme = 'light' | 'dark'

const THEME_KEY = 'codequest_theme'
export const DEFAULT_THEME: AppTheme = 'light'

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'light' || value === 'dark'
}

export function getStoredTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(THEME_KEY)
  return isAppTheme(value) ? value : null
}

export function applyTheme(theme: AppTheme = DEFAULT_THEME) {
  if (typeof document === 'undefined') return
  document.documentElement.dataset.theme = theme
}

export function persistTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_KEY, theme)
}

export function setTheme(theme: AppTheme) {
  applyTheme(theme)
  persistTheme(theme)
}
