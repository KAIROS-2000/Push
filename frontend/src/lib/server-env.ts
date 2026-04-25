import 'server-only'

function normalize(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/$/, '') : null
}

function getAppEnv() {
  return (
    normalize(process.env.APP_ENV) ||
    normalize(process.env.NEXT_PUBLIC_APP_ENV) ||
    process.env.NODE_ENV ||
    'development'
  ).toLowerCase()
}

function requireUrl(name: string) {
  const value = normalize(process.env[name])
  if (!value) {
    throw new Error(`${name} must be set when APP_ENV=production`)
  }
  return value
}

export const APP_ENV = getAppEnv()
export const IS_PRODUCTION = APP_ENV === 'production'
export const INTERNAL_API_URL = IS_PRODUCTION
  ? requireUrl('INTERNAL_API_URL')
  : normalize(process.env.INTERNAL_API_URL) || 'http://localhost:8000/api'
