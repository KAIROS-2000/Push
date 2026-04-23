'use client'

import type { UserItem } from '@/types'

export type SessionStatus = 'unknown' | 'authenticated' | 'anonymous'

export interface SessionSnapshot {
  status: SessionStatus
  user: UserItem | null
}

const SESSION_STORAGE_KEY = 'progyx:session-user'
const SESSION_CHANGE_EVENT = 'progyx:session-change'
const ACCESS_EXPIRES_AT_COOKIE = 'codequest_access_expires_at'
const ACCESS_EXPIRY_LEEWAY_MS = 1_000

let cachedSnapshot: SessionSnapshot | null = null

function isBrowser() {
  return typeof window !== 'undefined'
}

function defaultSnapshot(): SessionSnapshot {
  if (!isBrowser()) {
    return { status: 'unknown', user: null }
  }

  return hasFreshAccessToken() ? { status: 'unknown', user: null } : { status: 'anonymous', user: null }
}

function readCookie(name: string) {
  if (!isBrowser()) return null

  const prefix = `${name}=`
  const cookies = document.cookie ? document.cookie.split('; ') : []

  for (const cookie of cookies) {
    if (cookie.startsWith(prefix)) {
      return decodeURIComponent(cookie.slice(prefix.length))
    }
  }

  return null
}

function getAccessExpiryTimestamp(): number | null {
  const rawValue = readCookie(ACCESS_EXPIRES_AT_COOKIE)
  if (!rawValue) return null

  const parsedValue = Number(rawValue)
  return Number.isFinite(parsedValue) && parsedValue > 0 ? parsedValue * 1000 : null
}

export function hasFreshAccessToken(): boolean {
  const expiresAt = getAccessExpiryTimestamp()
  return Boolean(expiresAt && expiresAt > Date.now() + ACCESS_EXPIRY_LEEWAY_MS)
}

function normalizeSnapshot(snapshot: SessionSnapshot): SessionSnapshot {
  const hasAccessToken = hasFreshAccessToken()

  if (snapshot.status === 'authenticated' && !hasAccessToken) {
    return { status: 'unknown', user: null }
  }

  if (snapshot.status === 'anonymous' && hasAccessToken) {
    return { status: 'unknown', user: null }
  }

  return snapshot
}

function parseStoredSnapshot(rawValue: string | null): SessionSnapshot {
  if (!rawValue) {
    return defaultSnapshot()
  }

  try {
    const parsed = JSON.parse(rawValue) as SessionSnapshot
    if (
      !parsed ||
      typeof parsed !== 'object' ||
      !('status' in parsed) ||
      !['unknown', 'authenticated', 'anonymous'].includes(String(parsed.status))
    ) {
      return defaultSnapshot()
    }

    return normalizeSnapshot({
      status: parsed.status as SessionStatus,
      user: parsed.user ?? null,
    })
  } catch {
    return defaultSnapshot()
  }
}

function writeSnapshot(snapshot: SessionSnapshot) {
  if (!isBrowser()) return

  cachedSnapshot = snapshot
  window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(snapshot))
  window.dispatchEvent(new CustomEvent<SessionSnapshot>(SESSION_CHANGE_EVENT, { detail: snapshot }))
}

export function getSessionSnapshot(): SessionSnapshot {
  if (!isBrowser()) {
    return { status: 'unknown', user: null }
  }

  if (!cachedSnapshot) {
    cachedSnapshot = parseStoredSnapshot(window.localStorage.getItem(SESSION_STORAGE_KEY))
  } else {
    cachedSnapshot = normalizeSnapshot(cachedSnapshot)
  }

  if (cachedSnapshot.status === 'unknown') {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  }

  return cachedSnapshot
}

export function setAuthenticatedSession(user: UserItem) {
  writeSnapshot({ status: 'authenticated', user })
}

export function setAnonymousSession() {
  writeSnapshot({ status: 'anonymous', user: null })
}

export function setUnknownSession() {
  if (!isBrowser()) return

  cachedSnapshot = defaultSnapshot()

  if (cachedSnapshot.status === 'unknown') {
    window.localStorage.removeItem(SESSION_STORAGE_KEY)
  } else {
    window.localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(cachedSnapshot))
  }

  window.dispatchEvent(new CustomEvent<SessionSnapshot>(SESSION_CHANGE_EVENT, { detail: cachedSnapshot }))
}

export function subscribeSessionSnapshot(listener: (snapshot: SessionSnapshot) => void) {
  if (!isBrowser()) {
    return () => undefined
  }

  const handleCustomEvent = (event: Event) => {
    const detail = (event as CustomEvent<SessionSnapshot>).detail
    listener(normalizeSnapshot(detail ?? getSessionSnapshot()))
  }

  const handleStorageEvent = (event: StorageEvent) => {
    if (event.key !== SESSION_STORAGE_KEY) return

    cachedSnapshot = null
    listener(getSessionSnapshot())
  }

  window.addEventListener(SESSION_CHANGE_EVENT, handleCustomEvent as EventListener)
  window.addEventListener('storage', handleStorageEvent)

  return () => {
    window.removeEventListener(SESSION_CHANGE_EVENT, handleCustomEvent as EventListener)
    window.removeEventListener('storage', handleStorageEvent)
  }
}
