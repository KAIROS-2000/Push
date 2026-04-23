export type AppTheme = 'light' | 'dark'

const THEME_KEY = 'codequest_theme'
export const DEFAULT_THEME: AppTheme = 'light'
export const THEME_CHANGE_EVENT = 'progyx:theme-change'
export const THEME_TRANSITION_DURATION_MS = 620

type ThemeTransitionOptions = {
  origin?: { x: number; y: number }
  persist?: boolean
}

export function isAppTheme(value: unknown): value is AppTheme {
  return value === 'light' || value === 'dark'
}

export function resolveTheme(value: unknown, fallback: AppTheme = DEFAULT_THEME): AppTheme {
  return isAppTheme(value) ? value : fallback
}

export function getStoredTheme(): AppTheme | null {
  if (typeof window === 'undefined') return null
  const value = window.localStorage.getItem(THEME_KEY)
  return isAppTheme(value) ? value : null
}

export function getDocumentTheme(): AppTheme {
  if (typeof document === 'undefined') return DEFAULT_THEME
  return resolveTheme(document.documentElement.dataset.theme)
}

export function applyTheme(theme: AppTheme = DEFAULT_THEME) {
  if (typeof document === 'undefined') return
  const nextTheme = resolveTheme(theme)
  const root = document.documentElement
  const previousTheme = resolveTheme(root.dataset.theme)

  root.dataset.theme = nextTheme
  root.style.colorScheme = nextTheme

  if (typeof window !== 'undefined' && previousTheme !== nextTheme) {
    window.dispatchEvent(new CustomEvent<AppTheme>(THEME_CHANGE_EVENT, { detail: nextTheme }))
  }
}

export function persistTheme(theme: AppTheme) {
  if (typeof window === 'undefined') return
  window.localStorage.setItem(THEME_KEY, theme)
}

export function setTheme(theme: AppTheme, options?: { persist?: boolean }) {
  const persist = options?.persist ?? true
  const nextTheme = resolveTheme(theme)
  applyTheme(nextTheme)

  if (persist) {
    persistTheme(nextTheme)
  }
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

function resolveTransitionOrigin(origin?: { x: number; y: number }) {
  if (typeof window === 'undefined') return null

  return origin ?? {
    x: window.innerWidth / 2,
    y: window.innerHeight / 2,
  }
}

function getRevealRadius(origin: { x: number; y: number }) {
  if (typeof window === 'undefined') return 0

  const horizontal = Math.max(origin.x, window.innerWidth - origin.x)
  const vertical = Math.max(origin.y, window.innerHeight - origin.y)

  return Math.hypot(horizontal, vertical)
}

function clearThemeTransitionState(root: HTMLElement) {
  delete root.dataset.themeTransition
  delete root.dataset.themeTransitionTarget
}

export async function setThemeWithTransition(
  theme: AppTheme,
  options?: ThemeTransitionOptions,
) {
  const persist = options?.persist ?? true
  const nextTheme = resolveTheme(theme)

  if (persist) {
    persistTheme(nextTheme)
  }

  if (typeof document === 'undefined') {
    applyTheme(nextTheme)
    return
  }

  const root = document.documentElement
  const currentTheme = resolveTheme(root.dataset.theme)

  if (currentTheme === nextTheme) {
    applyTheme(nextTheme)
    return
  }

  const origin = resolveTransitionOrigin(options?.origin)
  if (
    !origin ||
    typeof document.startViewTransition !== 'function' ||
    typeof root.animate !== 'function' ||
    prefersReducedMotion()
  ) {
    applyTheme(nextTheme)
    return
  }

  root.dataset.themeTransition = 'running'
  root.dataset.themeTransitionTarget = nextTheme

  try {
    const transition = document.startViewTransition!.call(document, () => {
      applyTheme(nextTheme)
    })

    await transition.ready

    root.animate(
      {
        clipPath: [
          `circle(0px at ${origin.x}px ${origin.y}px)`,
          `circle(${getRevealRadius(origin)}px at ${origin.x}px ${origin.y}px)`,
        ],
      },
      {
        duration: THEME_TRANSITION_DURATION_MS,
        easing: 'cubic-bezier(0.76, 0, 0.24, 1)',
        fill: 'both',
        pseudoElement: '::view-transition-new(root)',
      },
    )

    await transition.finished
  } catch {
    applyTheme(nextTheme)
  } finally {
    clearThemeTransitionState(root)
  }
}

export function getThemeInitScript() {
  return `(() => {
    try {
      const key = ${JSON.stringify(THEME_KEY)};
      const stored = window.localStorage.getItem(key);
      const theme = stored === 'dark' || stored === 'light' ? stored : ${JSON.stringify(DEFAULT_THEME)};
      document.documentElement.dataset.theme = theme;
      document.documentElement.style.colorScheme = theme;
    } catch (error) {
      document.documentElement.dataset.theme = ${JSON.stringify(DEFAULT_THEME)};
      document.documentElement.style.colorScheme = ${JSON.stringify(DEFAULT_THEME)};
    }
  })();`
}
