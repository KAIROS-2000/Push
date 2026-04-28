import type { IncomingHttpHeaders } from 'node:http'
import { get as httpsGet } from 'node:https'
import { inflateRawSync } from 'node:zlib'
import { unstable_cache } from 'next/cache'

export interface TournamentOfficeRow {
	id: string
	office: string
	weekScores: Array<number | null>
	attendanceScore: number | null
	reviewScore: number | null
	total: number
	attendancePercent: number | null
	rank: number
}

export interface TournamentSourceMeta {
	fileName: string
	modified: string | null
	revision: number | null
	md5: string | null
	previewUrl: string | null
	downloadAvailable: boolean
	sourceUrl: string
}

export interface TournamentData {
	title: string
	rows: TournamentOfficeRow[]
	rules: string[]
	jury: string[]
	weekLabels: string[]
	meta: TournamentSourceMeta
	sourceMode: 'xlsx' | 'preview-snapshot'
	sourceWarning: string | null
}

interface YandexDiskSize {
	name?: string
	url?: string
}

interface YandexDiskMetadata {
	name?: string
	modified?: string
	md5?: string
	revision?: number
	public_key?: string
	preview?: string
	sizes?: YandexDiskSize[]
}

interface YandexDownloadResponse {
	href?: string
	method?: string
	templated?: boolean
}

interface ZipEntry {
	name: string
	compressionMethod: number
	compressedSize: number
	localHeaderOffset: number
}

const TOURNAMENT_PUBLIC_URL = (
	process.env.TOURNAMENT_YANDEX_PUBLIC_URL ||
	'https://disk.yandex.ru/i/IXI8UsHbHGdVjw'
).trim()

const YANDEX_PUBLIC_RESOURCES_URL =
	'https://cloud-api.yandex.net/v1/disk/public/resources'
const YANDEX_PUBLIC_DOWNLOAD_URL =
	'https://cloud-api.yandex.net/v1/disk/public/resources/download'
/** Lower than generic HTTP defaults — tournament page should fail fast to cache/fallback. */
const YANDEX_REQUEST_TIMEOUT_MS = 6500
const YANDEX_REQUEST_RETRY_COUNT = 1
const YANDEX_REQUEST_RETRY_DELAY_MS = 350
const YANDEX_USER_AGENT = 'Progyx tournament scoreboard'

/** Default 20 min if env missing/invalid. */
const DEFAULT_TOURNAMENT_CACHE_TTL_MS = 20 * 60 * 1000

/**
 * Server-side cache for XLSX parsed from Yandex Disk.
 * `TOURNAMENT_DATA_REFRESH_INTERVAL_SECONDS=0` disables cache (refresh on every request).
 */
function getTournamentDataCacheTtlMs(): number {
	const raw =
		process.env.TOURNAMENT_DATA_REFRESH_INTERVAL_SECONDS ??
		process.env.TOURNAMENT_REFRESH_INTERVAL_SECONDS ??
		process.env.TOURNAMENT_CACHE_TTL_SECONDS
	if (raw === undefined || String(raw).trim() === '') {
		return DEFAULT_TOURNAMENT_CACHE_TTL_MS
	}
	const sec = Number.parseInt(String(raw).trim(), 10)
	if (!Number.isFinite(sec) || sec < 0) {
		return DEFAULT_TOURNAMENT_CACHE_TTL_MS
	}
	return sec * 1000
}

/** Last fully successful XLSX parse (no sourceWarning). Used when Yandex briefly degrades. */
let lastSuccessfulTournamentData: TournamentData | null = null

const FALLBACK_ROWS: Omit<TournamentOfficeRow, 'rank'>[] = [
	// {
	// 	id: 'voshod',
	// 	office: 'Восход',
	// 	weekScores: [9, 24, null, null, null, null, null, null],
	// 	attendanceScore: 6,
	// 	reviewScore: 38,
	// 	total: 77,
	// 	attendancePercent: 89.062,
	// },
	// {
	// 	id: 'proletarskaya',
	// 	office: 'Пролетарская',
	// 	weekScores: [8, 24, null, null, null, null, null, null],
	// 	attendanceScore: 9,
	// 	reviewScore: 16,
	// 	total: 57,
	// 	attendancePercent: 89.125,
	// },
	// {
	// 	id: 'severny',
	// 	office: 'Северный',
	// 	weekScores: [4, 25, null, null, null, null, null, null],
	// 	attendanceScore: 6,
	// 	reviewScore: null,
	// 	total: 35,
	// 	attendancePercent: 76.501,
	// },
	// {
	// 	id: 'rostoshi',
	// 	office: 'Ростоши',
	// 	weekScores: [10, 26, null, null, null, null, null, null],
	// 	attendanceScore: 7,
	// 	reviewScore: 68,
	// 	total: 111,
	// 	attendancePercent: 89.381,
	// },
]

const FALLBACK_RULES = [
	'Каждую неделю мы считаем процент посещаемости по каждому офису.',
	'Офис с самым высоким процентом получает 4 балла',
	'Следующий — 3 балла',
	'Далее — 2 балла',
	'И последний — 1 балл',
	'За каждый отзыв или рекомендацию в чаты начисляется +1 балл.',
]

const FALLBACK_JURY = ['Директор', 'Маркетолог', 'Менеджер']

function buildYandexUrl(base: string, publicKey: string) {
	const params = new URLSearchParams({ public_key: publicKey })
	return `${base}?${params.toString()}`
}

function delay(ms: number) {
	return new Promise(resolve => setTimeout(resolve, ms))
}

function isAbortFetchError(error: unknown) {
	if (!(error instanceof Error)) return false
	const code =
		typeof error === 'object' && error !== null && 'code' in error
			? String((error as { code: unknown }).code)
			: ''
	return error.name === 'AbortError' || code.includes('ABORT')
}

function isProbablyNetworkFetchError(error: unknown) {
	return error instanceof TypeError
}

function isRetriableStatus(statusCode: number) {
	return statusCode === 408 || statusCode === 429 || statusCode >= 500
}

function httpsGetBufferOnce(
	url: string,
	redirectsLeft = 3,
): Promise<{ body: Buffer; headers: IncomingHttpHeaders; statusCode: number }> {
	return new Promise((resolve, reject) => {
		const request = httpsGet(
			url,
			{
				headers: {
					accept: '*/*',
					'user-agent': YANDEX_USER_AGENT,
				},
			},
			response => {
				const statusCode = response.statusCode ?? 0
				const location = response.headers.location

				if (
					statusCode >= 300 &&
					statusCode < 400 &&
					location &&
					redirectsLeft > 0
				) {
					response.resume()
					const redirectUrl = new URL(location, url).toString()
					resolve(httpsGetBuffer(redirectUrl, redirectsLeft - 1))
					return
				}

				const chunks: Buffer[] = []
				response.on('data', chunk => {
					chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk))
				})
				response.on('end', () => {
					resolve({
						body: Buffer.concat(chunks),
						headers: response.headers,
						statusCode,
					})
				})
			},
		)

		const timeout = setTimeout(() => {
			request.destroy(new Error('Yandex request timed out'))
		}, YANDEX_REQUEST_TIMEOUT_MS)
		request.setTimeout(YANDEX_REQUEST_TIMEOUT_MS, () => {
			request.destroy(new Error('Yandex request timed out'))
		})
		request.on('error', error => {
			clearTimeout(timeout)
			reject(error)
		})
		request.on('close', () => {
			clearTimeout(timeout)
		})
	})
}

async function httpsGetBuffer(
	url: string,
	redirectsLeft = 3,
): Promise<{ body: Buffer; headers: IncomingHttpHeaders; statusCode: number }> {
	let lastError: unknown = null

	for (let attempt = 0; attempt <= YANDEX_REQUEST_RETRY_COUNT; attempt += 1) {
		try {
			const response = await httpsGetBufferOnce(url, redirectsLeft)
			if (
				!isRetriableStatus(response.statusCode) ||
				attempt === YANDEX_REQUEST_RETRY_COUNT
			) {
				return response
			}
		} catch (error) {
			lastError = error
			if (attempt === YANDEX_REQUEST_RETRY_COUNT) {
				throw error
			}
		}

		await delay(YANDEX_REQUEST_RETRY_DELAY_MS * (attempt + 1))
	}

	throw lastError instanceof Error
		? lastError
		: new Error('Yandex request failed')
}

async function fetchYandexJson<T>(url: string): Promise<T> {
	let lastCatchError: unknown = null

	for (let attempt = 0; attempt <= YANDEX_REQUEST_RETRY_COUNT; attempt += 1) {
		const controller = new AbortController()
		const timeoutId = setTimeout(
			() => controller.abort(),
			YANDEX_REQUEST_TIMEOUT_MS,
		)

		try {
			const response = await fetch(url, {
				method: 'GET',
				signal: controller.signal,
				headers: {
					accept: 'application/json',
					'user-agent': YANDEX_USER_AGENT,
				},
				cache: 'no-store',
				redirect: 'follow',
			})

			clearTimeout(timeoutId)

			const text = await response.text()

			if (response.ok) {
				if (!text.trim()) {
					throw new Error('Yandex JSON response was empty')
				}
				try {
					return JSON.parse(text) as T
				} catch {
					throw new Error(
						`Yandex response was not JSON: ${text.slice(0, 200)}`,
					)
				}
			}

			if (
				isRetriableStatus(response.status) &&
				attempt < YANDEX_REQUEST_RETRY_COUNT
			) {
				await delay(YANDEX_REQUEST_RETRY_DELAY_MS * (attempt + 1))
				continue
			}

			throw new Error(
				`Yandex request failed: ${response.status} ${text.slice(0, 300)}`,
			)
		} catch (error) {
			clearTimeout(timeoutId)
			lastCatchError = error

			const canRetryFromCatch =
				attempt < YANDEX_REQUEST_RETRY_COUNT &&
				(isAbortFetchError(error) || isProbablyNetworkFetchError(error))

			if (canRetryFromCatch) {
				await delay(YANDEX_REQUEST_RETRY_DELAY_MS * (attempt + 1))
				continue
			}

			throw error instanceof Error
				? error
				: new Error('Yandex request failed')
		}
	}

	throw lastCatchError instanceof Error
		? lastCatchError
		: new Error('Yandex request failed')
}

/** Decodes XML/HTML entities from XLSX (incl. numeric like &#xA; for line breaks). */
function xmlDecode(value: string) {
	let s = value
	for (let pass = 0; pass < 3; pass += 1) {
		const before = s
		s = s
			.replace(/&#x([0-9a-fA-F]{1,6});?/gi, (_, hex) => {
				const code = parseInt(hex, 16)
				if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
					return ''
				}
				try {
					return String.fromCodePoint(code)
				} catch {
					return ''
				}
			})
			.replace(/&#(\d{1,8});?/g, (_, dec) => {
				const code = parseInt(dec, 10)
				if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) {
					return ''
				}
				try {
					return String.fromCodePoint(code)
				} catch {
					return ''
				}
			})
			.replace(/&quot;/g, '"')
			.replace(/&apos;/g, "'")
			.replace(/&lt;/g, '<')
			.replace(/&gt;/g, '>')
			.replace(/&amp;/g, '&')
		if (s === before) break
	}
	return s
}

/** Collapses breaks/spaces so rule bullets stay readable in the UI. */
function normalizeRuleDisplayText(value: string) {
	const decoded = xmlDecode(value)
	return decoded
		.replace(/\u00a0/g, ' ')
		.replace(/[\r\n\f\v]+/g, ' ')
		.replace(/\s+/g, ' ')
		.trim()
}

/**
 * The XLSX puts the attendance scoring rule into a single cell with newlines
 * and em-dash bullets ("— офис с самым высоким..."). Split on real line
 * breaks only (not internal em-dashes, since phrases like "следующий — 3
 * балла" must stay intact) and strip the leading bullet marker.
 */
function splitRuleBullets(value: string) {
	const decoded = xmlDecode(value).replace(/\u00a0/g, ' ')
	return decoded
		.split(/[\r\n]+/)
		.map(part =>
			part
				.replace(/^\s*[\u2022\u2014\u2013-]+\s*/u, '')
				.replace(/\s+/g, ' ')
				.trim(),
		)
		.map(part => (part ? part.charAt(0).toLocaleUpperCase('ru-RU') + part.slice(1) : part))
		.filter(Boolean)
}

function stripXmlTags(value: string) {
	return xmlDecode(value.replace(/<[^>]*>/g, '')).trim()
}

/** Normalizes trimmed cell strings (drops Excel BOM sometimes present in заголовках). */
function safeText(value: unknown) {
	if (typeof value !== 'string') return ''
	return value.replace(/^\ufeff+/u, '').trim()
}

/** Колонки «Неделя 1»: допускает «Неделя1», «Неделя 01», «нед. 2» и порядок любой в таблице. */
function extractWeekOrdinalFromHeader(header: string): number | null {
	const normalized = safeText(header).toLowerCase()
	const match =
		normalized.match(/^неделя\s*[.\s]*(\d{1,2})\b/u) ??
		normalized.match(/^нед\.?\s*(\d{1,2})\b/u)
	if (!match) return null
	const n = Number.parseInt(match[1] ?? '', 10)
	return Number.isFinite(n) && n > 0 ? n : null
}

interface WeekColumnPick {
	header: string
	index: number
}

function cellNumber(value: unknown) {
	if (typeof value === 'number' && Number.isFinite(value)) {
		return value
	}

	const text = safeText(value)
		.replace('%', '')
		.replace(',', '.')
		.trim()

	if (!text) return null

	const numberValue = Number(text)
	return Number.isFinite(numberValue) ? numberValue : null
}

function normalizePercent(value: unknown) {
	const numberValue = cellNumber(value)
	if (numberValue === null) return null
	return numberValue > 0 && numberValue <= 1 ? numberValue * 100 : numberValue
}

function officeId(value: string) {
	return value
		.toLocaleLowerCase('ru-RU')
		.replace(/ё/g, 'е')
		.replace(/[^a-zа-я0-9]+/giu, '-')
		.replace(/^-|-$/g, '')
}

function assignRanks(rows: Omit<TournamentOfficeRow, 'rank'>[]) {
	return [...rows]
		.sort((a, b) => b.total - a.total || a.office.localeCompare(b.office, 'ru'))
		.map((row, index) => ({ ...row, rank: index + 1 }))
}

function bestPreviewUrl(metadata: YandexDiskMetadata) {
	const sizes = metadata.sizes ?? []
	const preferred = ['XXXL', 'XXL', 'XL', 'L', 'DEFAULT']
	for (const name of preferred) {
		const match = sizes.find(size => size.name === name && size.url)
		if (match?.url) return match.url
	}
	return metadata.preview ?? sizes.find(size => size.url)?.url ?? null
}

async function fetchYandexMetadata() {
	return fetchYandexJson<YandexDiskMetadata>(
		buildYandexUrl(YANDEX_PUBLIC_RESOURCES_URL, TOURNAMENT_PUBLIC_URL),
	)
}

async function fetchDownloadHref(publicKey: string) {
	const data = await fetchYandexJson<YandexDownloadResponse>(
		buildYandexUrl(YANDEX_PUBLIC_DOWNLOAD_URL, publicKey.trim()),
	).catch(() => null)
	if (!data) return null

	const href = safeText(data.href)
	return href || null
}

function readUInt16(buffer: Buffer, offset: number) {
	return buffer.readUInt16LE(offset)
}

function readUInt32(buffer: Buffer, offset: number) {
	return buffer.readUInt32LE(offset)
}

function findEndOfCentralDirectory(buffer: Buffer) {
	const minOffset = Math.max(0, buffer.length - 0xffff - 22)
	for (let offset = buffer.length - 22; offset >= minOffset; offset -= 1) {
		if (readUInt32(buffer, offset) === 0x06054b50) {
			return offset
		}
	}
	throw new Error('XLSX central directory was not found')
}

function readZipEntries(buffer: Buffer) {
	const eocdOffset = findEndOfCentralDirectory(buffer)
	const entryCount = readUInt16(buffer, eocdOffset + 10)
	const centralDirectoryOffset = readUInt32(buffer, eocdOffset + 16)
	const entries = new Map<string, Buffer>()

	let offset = centralDirectoryOffset
	for (let index = 0; index < entryCount; index += 1) {
		if (readUInt32(buffer, offset) !== 0x02014b50) {
			throw new Error('Invalid XLSX central directory')
		}

		const compressionMethod = readUInt16(buffer, offset + 10)
		const compressedSize = readUInt32(buffer, offset + 20)
		const fileNameLength = readUInt16(buffer, offset + 28)
		const extraLength = readUInt16(buffer, offset + 30)
		const commentLength = readUInt16(buffer, offset + 32)
		const localHeaderOffset = readUInt32(buffer, offset + 42)
		const name = buffer
			.subarray(offset + 46, offset + 46 + fileNameLength)
			.toString('utf8')

		const entry: ZipEntry = {
			name,
			compressionMethod,
			compressedSize,
			localHeaderOffset,
		}

		entries.set(name, inflateZipEntry(buffer, entry))
		offset += 46 + fileNameLength + extraLength + commentLength
	}

	return entries
}

function inflateZipEntry(buffer: Buffer, entry: ZipEntry) {
	const localOffset = entry.localHeaderOffset
	if (readUInt32(buffer, localOffset) !== 0x04034b50) {
		throw new Error(`Invalid XLSX local header for ${entry.name}`)
	}

	const fileNameLength = readUInt16(buffer, localOffset + 26)
	const extraLength = readUInt16(buffer, localOffset + 28)
	const dataStart = localOffset + 30 + fileNameLength + extraLength
	const compressed = buffer.subarray(
		dataStart,
		dataStart + entry.compressedSize,
	)

	if (entry.compressionMethod === 0) {
		return Buffer.from(compressed)
	}

	if (entry.compressionMethod === 8) {
		return inflateRawSync(compressed)
	}

	throw new Error(`Unsupported XLSX compression method ${entry.compressionMethod}`)
}

function parseSharedStrings(xml: string) {
	const values: string[] = []
	for (const match of xml.matchAll(/<si\b[^>]*>([\s\S]*?)<\/si>/g)) {
		const si = match[1] ?? ''
		const parts = [...si.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(part =>
			xmlDecode(part[1] ?? ''),
		)
		values.push(parts.length > 0 ? parts.join('') : stripXmlTags(si))
	}
	return values
}

function columnIndex(cellRef: string) {
	const letters = (cellRef.match(/[A-Z]+/i)?.[0] ?? '').toUpperCase()
	let value = 0
	for (const letter of letters) {
		value = value * 26 + (letter.charCodeAt(0) - 64)
	}
	return Math.max(0, value - 1)
}

function parseCellValue(
	attrs: string,
	body: string,
	sharedStrings: string[],
) {
	const type = attrs.match(/\bt="([^"]+)"/)?.[1]
	const rawValue = body.match(/<v[^>]*>([\s\S]*?)<\/v>/)?.[1]

	if (type === 'inlineStr') {
		const inner = body.match(/<is\b[^>]*>([\s\S]*?)<\/is>/)?.[1] ?? body
		const parts = [...inner.matchAll(/<t\b[^>]*>([\s\S]*?)<\/t>/g)].map(part =>
			xmlDecode(part[1] ?? ''),
		)
		return parts.length > 0 ? parts.join('') : stripXmlTags(inner)
	}

	if (type === 's') {
		const index = Number(rawValue)
		return Number.isInteger(index) ? sharedStrings[index] ?? '' : ''
	}

	if (type === 'str') {
		return xmlDecode(rawValue ?? '')
	}

	if (type === 'b') {
		return rawValue === '1'
	}

	if (rawValue === undefined) return ''

	const numericValue = Number(rawValue)
	return Number.isFinite(numericValue) ? numericValue : xmlDecode(rawValue)
}

/**
 * Excel writes empty cells as self-closing `<c r="D5" s="9"/>` tags. A naive
 * `<c ...>...</c>` regex consumes those plus the next non-empty cell as a
 * single match, which silently shifts every value left and ruins ordinal
 * lookups (week columns, attendance, reviews, total, %). This walker handles
 * both `<c .../>` and `<c ...>content</c>` cells so each cell is mapped to its
 * exact column index from the `r="..."` reference.
 */
function parseWorksheet(xml: string, sharedStrings: string[]) {
	const rows: unknown[][] = []
	const cellRegex = /<c\b([^>]*?)(\/>|>([\s\S]*?)<\/c>)/g

	for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const rowXml = rowMatch[1] ?? ''
		const row: unknown[] = []
		let cursor = 0

		cellRegex.lastIndex = 0
		for (const cellMatch of rowXml.matchAll(cellRegex)) {
			const attrs = cellMatch[1] ?? ''
			const isSelfClosing = cellMatch[2] === '/>'
			const body = isSelfClosing ? '' : cellMatch[3] ?? ''
			const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? ''
			const index = ref ? columnIndex(ref) : cursor
			row[index] = isSelfClosing
				? ''
				: parseCellValue(attrs, body, sharedStrings)
			cursor = index + 1
		}

		rows.push(row)
	}

	return rows
}

function findFirstWorksheet(entries: Map<string, Buffer>) {
	if (entries.has('xl/worksheets/sheet1.xml')) {
		return entries.get('xl/worksheets/sheet1.xml')?.toString('utf8') ?? ''
	}

	const firstSheet = [...entries.keys()]
		.filter(name => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
		.sort()[0]

	return firstSheet ? entries.get(firstSheet)?.toString('utf8') ?? '' : ''
}

/**
 * The XLSX repeats short header labels like "Баллы за отзывы и рекомендации"
 * and the section title "Как считаем баллы за посещаемость" both as column
 * captions and as headings before the actual rule sentence. We must filter
 * those out so the UI shows real rules, not section titles.
 */
function isSectionTitleText(value: string) {
	return (
		/^баллы\s+за\b/iu.test(value) ||
		/^как\s+считаем\b/iu.test(value) ||
		/^жюри\b/iu.test(value)
	)
}

function looksLikeRuleSentence(value: string) {
	if (value.length < 32) return false
	if (isSectionTitleText(value)) return false
	return /каждую неделю|высоким процентом|отзыв|рекомендац|получает|балла|\+\s*\d/iu.test(
		value,
	)
}

function parseRules(rows: unknown[][]) {
	const text = rows.flat().map(safeText).filter(Boolean)

	const candidates = text.filter(
		value =>
			!/турнирная таблица/iu.test(value) &&
			!isSectionTitleText(value) &&
			(looksLikeRuleSentence(value) || /[\r\n]/.test(value)),
	)

	if (candidates.length === 0) return FALLBACK_RULES

	const bullets: string[] = []
	const seen = new Set<string>()
	for (const candidate of candidates) {
		const parts = /[\r\n]/.test(candidate)
			? splitRuleBullets(candidate)
			: [normalizeRuleDisplayText(candidate)]
		for (const part of parts) {
			if (!part || seen.has(part)) continue
			if (isSectionTitleText(part)) continue
			seen.add(part)
			bullets.push(part)
		}
	}

	return bullets.length > 0 ? bullets : FALLBACK_RULES
}

function parseJury(rows: unknown[][]) {
	const values = rows.flat().map(safeText)
	const juryCell = values.find(value => /жюри/i.test(value))
	if (!juryCell) return FALLBACK_JURY

	const [, rawJury = ''] = juryCell.split(/жюри\s*:?/i)
	const jury = rawJury
		.split(/\s*(?:,|;|\n|\sи\s)+\s*/iu)
		.map(value => value.replace(/\s+/g, ' ').trim())
		.map(value =>
			value
				? value.charAt(0).toLocaleUpperCase('ru-RU') + value.slice(1)
				: value,
		)
		.filter(Boolean)

	return jury.length > 0 ? jury : FALLBACK_JURY
}

/**
 * JS `\b` only recognizes ASCII word characters, so naïve patterns like
 * `^офис\b` never match Cyrillic. We use anchored, character-class-based
 * matching instead so the header detection survives optional plural endings
 * and trailing punctuation/whitespace.
 */
function isOfficeHeaderText(text: string) {
	return (
		/^офис(ы|ов|у|а)?[\s.:;,()\-]*$/iu.test(text) ||
		/^подраздел/iu.test(text) ||
		/^название/iu.test(text)
	)
}

function parseTournamentRows(sheetRows: unknown[][]) {
	const headerIndex = sheetRows.findIndex(row =>
		row.some(cell => isOfficeHeaderText(safeText(cell))),
	)

	if (headerIndex < 0) {
		return {
			rows: assignRanks(FALLBACK_ROWS),
			weekLabels: Array.from({ length: 8 }, (_, index) => `Неделя ${index + 1}`),
		}
	}

	const headers = sheetRows[headerIndex].map(cell => safeText(cell))
	let officeColumn = headers.findIndex(header => isOfficeHeaderText(header))
	if (officeColumn < 0) {
		officeColumn = headers.findIndex(header => /офис/iu.test(header))
	}
	const weekColumnsParsed = headers
		.map((header, index) => ({
			header,
			index,
			weekNum: extractWeekOrdinalFromHeader(header),
		}))
		.filter(
			(
				column,
			): column is { header: string; index: number; weekNum: number } =>
				column.weekNum !== null,
		)
	const weekColumns: WeekColumnPick[] =
		weekColumnsParsed.length > 0
			? [...weekColumnsParsed]
					.sort((a, b) => a.weekNum - b.weekNum)
					.map(({ header, index }) => ({ header, index }))
			: []

	const isWeekHeader = (header: string) =>
		extractWeekOrdinalFromHeader(header) !== null
	const isTotalHeader = (header: string) =>
		/^итого(?![а-яa-z])/iu.test(header.toLowerCase())

	const attendanceColumn = headers.findIndex(header => {
		const h = header.toLowerCase()
		if (isWeekHeader(header) || /^%/.test(header) || isTotalHeader(header)) {
			return false
		}
		return (
			h.includes('посещаемость') ||
			/балл.*посещ/iu.test(header) ||
			(/посещ/iu.test(header) &&
				!/отзыв|рекомендац/iu.test(header) &&
				!/процент/iu.test(header))
		)
	})
	const reviewColumn = headers.findIndex(header => {
		if (isWeekHeader(header) || /^%/.test(header) || isTotalHeader(header)) {
			return false
		}
		return (
			/отзыв|рекомендац/iu.test(header) &&
			!/посещаемость/iu.test(header) &&
			!/балл.*посещ/iu.test(header)
		)
	})
	const totalColumn = headers.findIndex(header => isTotalHeader(header))

	const pctIdx = headers.findIndex(header => /^%|^процент/iu.test(header))
	const percentColumn =
		pctIdx >= 0
			? pctIdx
			: totalColumn >= 0 && totalColumn + 1 < headers.length
				? totalColumn + 1
				: -1

	const reservedCols = new Set<number>()
	for (const { index } of weekColumns) {
		reservedCols.add(index)
	}
	for (const col of [
		attendanceColumn,
		reviewColumn,
		totalColumn,
		percentColumn,
	]) {
		if (col >= 0) reservedCols.add(col)
	}

	if (officeColumn < 0) {
		const hinted = headers.findIndex(
			(header, idx) =>
				!reservedCols.has(idx) &&
				(/назван|офис|подраздел/iu.test(header) ||
					(header.trim().length === 0 && idx === 0)),
		)
		if (hinted >= 0) officeColumn = hinted
	}
	if (officeColumn < 0) {
		const firstUnused = headers.findIndex((_, idx) => !reservedCols.has(idx))
		officeColumn = firstUnused >= 0 ? firstUnused : 0
	}

	const rows: Omit<TournamentOfficeRow, 'rank'>[] = []

	for (const sourceRow of sheetRows.slice(headerIndex + 1)) {
		const office = safeText(sourceRow[officeColumn])
		const trimmedOffice = office.trim()

		const isFooterRow =
			/^итого(?![а-яa-z])|^всего(?![а-яa-z])|^сумма|^средн|^место/iu.test(
				trimmedOffice,
			) || trimmedOffice.toUpperCase() === 'TOTAL'

		// Stops parsing when we walk off the office block into the rule/jury
		// blocks below. Those cells live in column A too ("Как считаем баллы…"
		// / "Баллы за отзывы и рекомендации"), so name-only filters are not
		// enough — we also require it to look like a scoring row.
		const looksLikeScoringPrompt =
			/посещаем|отзыв|рекомендац|считаем|жюри|правил/iu.test(trimmedOffice)

		if (!trimmedOffice || isFooterRow || looksLikeScoringPrompt) continue

		const total = cellNumber(sourceRow[totalColumn])
		const weekScores = weekColumns.map(({ index }) =>
			cellNumber(sourceRow[index]),
		)
		const attendanceScore = cellNumber(sourceRow[attendanceColumn])
		const reviewScore = cellNumber(sourceRow[reviewColumn])
		const computedTotal =
			weekScores.reduce<number>((sum, value) => sum + (value ?? 0), 0) +
			(attendanceScore ?? 0) +
			(reviewScore ?? 0)

		const hasAnyNumericData =
			total !== null ||
			attendanceScore !== null ||
			reviewScore !== null ||
			weekScores.some(value => value !== null)

		if (!hasAnyNumericData) continue

		rows.push({
			id: officeId(trimmedOffice),
			office: trimmedOffice,
			weekScores,
			attendanceScore,
			reviewScore,
			total: total ?? computedTotal,
			attendancePercent: normalizePercent(sourceRow[percentColumn]),
		})
	}

	return {
		rows: assignRanks(rows.length > 0 ? rows : FALLBACK_ROWS),
		weekLabels:
			weekColumns.length > 0
				? weekColumns.map(({ header }) => header)
				: Array.from({ length: 8 }, (_, index) => `Неделя ${index + 1}`),
	}
}

function parseXlsx(buffer: ArrayBuffer | Buffer) {
	const entries = readZipEntries(Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer))
	const sharedStringsXml = entries.get('xl/sharedStrings.xml')?.toString('utf8')
	const sharedStrings = sharedStringsXml
		? parseSharedStrings(sharedStringsXml)
		: []
	const worksheetXml = findFirstWorksheet(entries)
	if (!worksheetXml) {
		throw new Error('XLSX worksheet was not found')
	}

	const sheetRows = parseWorksheet(worksheetXml, sharedStrings)
	const parsedRows = parseTournamentRows(sheetRows)

	return {
		...parsedRows,
		rules: parseRules(sheetRows),
		jury: parseJury(sheetRows),
	}
}

function buildMeta(
	metadata: YandexDiskMetadata,
	downloadAvailable: boolean,
): TournamentSourceMeta {
	return {
		fileName: metadata.name ?? 'Турнир между офисами .xlsx',
		modified: metadata.modified ?? null,
		revision: metadata.revision ?? null,
		md5: metadata.md5 ?? null,
		previewUrl: bestPreviewUrl(metadata),
		downloadAvailable,
		sourceUrl: TOURNAMENT_PUBLIC_URL,
	}
}

function fallbackTournamentData(
	metadata: YandexDiskMetadata,
	downloadAvailable: boolean,
	sourceWarning =
		'У публичного файла отключено скачивание, поэтому структурные данные показаны из последнего доступного снимка. Live preview подтягивается напрямую из Yandex Disk.',
): TournamentData {
	return {
		title: 'Турнир между офисами',
		rows: assignRanks(FALLBACK_ROWS),
		rules: FALLBACK_RULES,
		jury: FALLBACK_JURY,
		weekLabels: Array.from({ length: 8 }, (_, index) => `Неделя ${index + 1}`),
		meta: buildMeta(metadata, downloadAvailable),
		sourceMode: 'preview-snapshot',
		sourceWarning,
	}
}

export async function getTournamentPreviewUrl() {
	const metadata = await fetchYandexMetadata()
	return bestPreviewUrl(metadata)
}

/**
 * When Yandex returns a degraded snapshot (sourceWarning set), keep showing the
 * last fully successful parse in-process (same behavior as the old in-memory
 * cache merge).
 */
function preferLastGoodIfDegraded(candidate: TournamentData): TournamentData {
	if (candidate.sourceWarning === null) {
		lastSuccessfulTournamentData = candidate
		return candidate
	}
	if (lastSuccessfulTournamentData?.sourceWarning === null) {
		return lastSuccessfulTournamentData
	}
	return candidate
}

async function loadTournamentData(): Promise<TournamentData> {
	const [metaSettled, downloadEarlySettled] = await Promise.allSettled([
		fetchYandexMetadata(),
		fetchDownloadHref(TOURNAMENT_PUBLIC_URL),
	])

	if (metaSettled.status === 'rejected') {
		return preferLastGoodIfDegraded(
			fallbackTournamentData(
				{},
				false,
				'Не удалось получить метаданные Yandex Disk с сервера, поэтому показан последний сохраненный снимок таблицы.',
			),
		)
	}

	const metadata = metaSettled.value
	const publicKey = safeText(metadata.public_key) || TOURNAMENT_PUBLIC_URL

	let downloadHref =
		downloadEarlySettled.status === 'fulfilled'
			? downloadEarlySettled.value
			: null

	if (!downloadHref) {
		downloadHref = await fetchDownloadHref(publicKey)
	}

	if (!downloadHref) {
		return preferLastGoodIfDegraded(fallbackTournamentData(metadata, false))
	}

	try {
		const response = await httpsGetBuffer(downloadHref)
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`Yandex XLSX download failed: ${response.statusCode}`)
		}

		const parsed = parseXlsx(response.body)

		return preferLastGoodIfDegraded({
			title: 'Турнир между офисами',
			rows: parsed.rows,
			rules: parsed.rules,
			jury: parsed.jury,
			weekLabels: parsed.weekLabels,
			meta: buildMeta(metadata, true),
			sourceMode: 'xlsx',
			sourceWarning: null,
		})
	} catch {
		return preferLastGoodIfDegraded(
			fallbackTournamentData(
				metadata,
				true,
				'XLSX-файл доступен, но его не удалось разобрать. Показан последний сохраненный снимок таблицы.',
			),
		)
	}
}

export async function getTournamentData(): Promise<TournamentData> {
	const ttlMs = getTournamentDataCacheTtlMs()
	if (ttlMs <= 0) {
		return loadTournamentData()
	}

	const revalidateSec = Math.max(60, Math.floor(ttlMs / 1000))

	return unstable_cache(loadTournamentData, ['tournament-data', TOURNAMENT_PUBLIC_URL], {
		revalidate: revalidateSec,
		tags: ['tournament'],
	})()
}
