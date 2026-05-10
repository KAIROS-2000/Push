const RU_LOCALE = 'ru-RU'

const INSTANT_RU: Intl.DateTimeFormatOptions = {
	dateStyle: 'medium',
	timeStyle: 'short',
}

/**
 * Use in client-side handlers (e.g. toasts) to show an API instant in the user’s timezone.
 * Not for SSR: use <UserLocalTime /> for on-screen text rendered during static/SSR.
 */
export function formatUserInstantRu(
	iso: string | null | undefined,
	options: Intl.DateTimeFormatOptions = INSTANT_RU,
): string {
	if (iso == null || String(iso).trim() === '') return '—'
	const d = new Date(iso)
	if (Number.isNaN(d.getTime())) return '—'
	return new Intl.DateTimeFormat(RU_LOCALE, options).format(d)
}

/**
 * API returns calendar bucket keys as YYYY-MM-DD. Do not use `new Date("YYYY-MM-DD")` — it
 * parses as UTC and shifts labels. Build a local calendar Date from components instead.
 */
function parseYmdToLocalDate(ymd: string): Date | null {
	const m = ymd.match(/^(\d{4})-(\d{2})-(\d{2})$/)
	if (!m) return null
	const y = Number(m[1])
	const mon = Number(m[2])
	const d = Number(m[3])
	const date = new Date(y, mon - 1, d)
	if (
		date.getFullYear() !== y
		|| date.getMonth() !== mon - 1
		|| date.getDate() !== d
	) {
		return null
	}
	return date
}

/**
 * A stable label for a YYYY-MM-DD bucket from the API (no UTC date-only parsing shift).
 * Safe for use on the server and on the client.
 */
export function formatApiCalendarDayLabelRu(
	ymd: string,
	options: Intl.DateTimeFormatOptions = { day: '2-digit', month: 'short' },
): string {
	const local = parseYmdToLocalDate(ymd)
	if (local) {
		return new Intl.DateTimeFormat(RU_LOCALE, options).format(local)
	}
	const fromIso = new Date(ymd)
	if (Number.isNaN(fromIso.getTime())) return ymd
	return new Intl.DateTimeFormat(RU_LOCALE, options).format(fromIso)
}

const pad = (n: number) => String(n).padStart(2, '0')

/**
 * Local browser calendar + clock (same TZ as {@link UserLocalTime}).
 * Stem for filenames: `YYYY-MM-DD_HH-MM-SS`.
 */
export function formatLocalInstantForFilenameStem(date: Date = new Date()): string {
	const y = date.getFullYear()
	const m = pad(date.getMonth() + 1)
	const d = pad(date.getDate())
	const h = pad(date.getHours())
	const min = pad(date.getMinutes())
	const s = pad(date.getSeconds())
	return `${y}-${m}-${d}_${h}-${min}-${s}`
}
