function normalize(value: string | undefined) {
  const trimmed = value?.trim()
  return trimmed ? trimmed.replace(/\/$/, '') : null
}

function getAppEnv() {
  return (normalize(process.env.NEXT_PUBLIC_APP_ENV) || process.env.NODE_ENV || 'development').toLowerCase()
}

const configuredPublicApiUrl = normalize(process.env.NEXT_PUBLIC_API_URL)

function requirePublicApiUrl() {
  if (!configuredPublicApiUrl) {
    throw new Error('NEXT_PUBLIC_API_URL must be set when NEXT_PUBLIC_APP_ENV=production')
  }
  return configuredPublicApiUrl
}

export const PUBLIC_APP_ENV = getAppEnv()
export const PUBLIC_IS_PRODUCTION = PUBLIC_APP_ENV === 'production'
export const PUBLIC_API_URL = PUBLIC_IS_PRODUCTION
  ? requirePublicApiUrl()
  : configuredPublicApiUrl || 'http://localhost:3000/api'
