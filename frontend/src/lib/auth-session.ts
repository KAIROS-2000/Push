'use client'

import { useEffect, useState } from 'react'
import { ApiError, api } from '@/lib/api'
import {
  getSessionSnapshot,
  setAnonymousSession,
  setAuthenticatedSession,
  subscribeSessionSnapshot,
  type SessionSnapshot,
} from '@/lib/session-store'
import type { AuthMode } from '@/lib/api'
import type { UserItem } from '@/types'

let sessionRequest: Promise<UserItem | null> | null = null

function canReuseSnapshot(snapshot: SessionSnapshot, auth: AuthMode) {
  if (snapshot.status === 'authenticated') {
    return true
  }

  return auth === 'optional' && snapshot.status === 'anonymous'
}

export async function fetchSessionUser({
  auth = 'optional',
  force = false,
}: {
  auth?: AuthMode
  force?: boolean
} = {}) {
  const snapshot = getSessionSnapshot()
  if (!force && canReuseSnapshot(snapshot, auth)) {
    return snapshot.user
  }

  if (sessionRequest) {
    return sessionRequest
  }

  sessionRequest = api<{ user: UserItem }>('/auth/me', undefined, { auth })
    .then((result) => {
      setAuthenticatedSession(result.user)
      return result.user
    })
    .catch((error) => {
      if (error instanceof ApiError && error.status === 401) {
        setAnonymousSession()
        if (auth === 'optional') {
          return null
        }
      }

      throw error
    })
    .finally(() => {
      sessionRequest = null
    })

  return sessionRequest
}

export function useSessionUser({
  auth = 'optional',
  enabled = true,
}: {
  auth?: AuthMode
  enabled?: boolean
} = {}) {
  const [snapshot, setSnapshot] = useState<SessionSnapshot>({
    status: 'unknown',
    user: null,
  })

  useEffect(() => {
    setSnapshot(getSessionSnapshot())
    return subscribeSessionSnapshot(setSnapshot)
  }, [])

  useEffect(() => {
    if (!enabled || snapshot.status !== 'unknown') {
      return
    }

    let cancelled = false

    fetchSessionUser({ auth })
      .then(() => {
        if (!cancelled) {
          setSnapshot(getSessionSnapshot())
        }
      })
      .catch(() => {
        if (!cancelled) {
          setSnapshot(getSessionSnapshot())
        }
      })

    return () => {
      cancelled = true
    }
  }, [auth, enabled, snapshot.status])

  return {
    user: snapshot.user,
    status: snapshot.status,
    isAuthenticated: snapshot.status === 'authenticated',
    isResolved: snapshot.status !== 'unknown',
    refresh: () =>
      fetchSessionUser({ auth, force: true }).then((user) => {
        setSnapshot(getSessionSnapshot())
        return user
      }),
  }
}
