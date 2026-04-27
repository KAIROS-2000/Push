export const AUTH_ROUTE_PREFIXES = ['/auth/login', '/auth/register'] as const

export const PROTECTED_ROUTE_PREFIXES = [
  '/dashboard',
  '/messages',
  '/roadmap',
  '/lessons',
  '/leaderboard',
  '/profile',
  '/parent/dashboard',
  '/teacher',
  '/admin',
  '/superadmin',
] as const

export function pathMatches(pathname: string, target: string) {
  return pathname === target || pathname.startsWith(`${target}/`)
}

export function isAuthRoutePath(pathname: string) {
  return AUTH_ROUTE_PREFIXES.some((route) => pathMatches(pathname, route))
}

export function isProtectedRoutePath(pathname: string) {
  return PROTECTED_ROUTE_PREFIXES.some((route) => pathMatches(pathname, route))
}
