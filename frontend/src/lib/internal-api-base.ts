/** API base usable from `proxy.ts` (avoid importing `server-only` server-env). */
export function getInternalApiBaseUrl(): string {
	const trimmed = process.env.INTERNAL_API_URL?.trim()
	if (trimmed) {
		return trimmed.replace(/\/$/, '')
	}
	if (process.env.NODE_ENV === 'production') {
		throw new Error('INTERNAL_API_URL is required in production for proxy')
	}
	return 'http://localhost:8000/api'
}
