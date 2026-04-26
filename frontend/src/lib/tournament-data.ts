import type { IncomingHttpHeaders } from 'node:http'
import { get as httpsGet } from 'node:https'
import { inflateRawSync } from 'node:zlib'

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

const TOURNAMENT_PUBLIC_URL =
	process.env.TOURNAMENT_YANDEX_PUBLIC_URL ||
	'https://disk.yandex.ru/i/IXI8UsHbHGdVjw'

const YANDEX_PUBLIC_RESOURCES_URL =
	'https://cloud-api.yandex.net/v1/disk/public/resources'
const YANDEX_PUBLIC_DOWNLOAD_URL =
	'https://cloud-api.yandex.net/v1/disk/public/resources/download'
const YANDEX_REQUEST_TIMEOUT_MS = 3000
const YANDEX_USER_AGENT = 'Progyx tournament scoreboard'

const FALLBACK_ROWS: Omit<TournamentOfficeRow, 'rank'>[] = [
	{
		id: 'voshod',
		office: 'Восход',
		weekScores: [9, 24, null, null, null, null, null, null],
		attendanceScore: 4,
		reviewScore: 38,
		total: 75,
		attendancePercent: 76.846,
	},
	{
		id: 'proletarskaya',
		office: 'Пролетарская',
		weekScores: [8, 24, null, null, null, null, null, null],
		attendanceScore: 6,
		reviewScore: 16,
		total: 54,
		attendancePercent: 89.157,
	},
	{
		id: 'severny',
		office: 'Северный',
		weekScores: [4, 25, null, null, null, null, null, null],
		attendanceScore: 5,
		reviewScore: null,
		total: 34,
		attendancePercent: 78.337,
	},
	{
		id: 'rostoshi',
		office: 'Ростоши',
		weekScores: [10, 26, null, null, null, null, null, null],
		attendanceScore: 3,
		reviewScore: 68,
		total: 107,
		attendancePercent: 77.347,
	},
]

const FALLBACK_RULES = [
	'Каждую неделю считается процент посещаемости по каждому офису.',
	'Офис с самым высоким процентом получает 4 балла, следующий - 3 балла, далее - 2 балла, последний - 1 балл.',
	'За каждый отзыв или рекомендацию в чаты начисляется +1 балл.',
]

const FALLBACK_JURY = ['Директор', 'Маркетолог', 'Менеджер']

function buildYandexUrl(base: string, publicKey: string) {
	const params = new URLSearchParams({ public_key: publicKey })
	return `${base}?${params.toString()}`
}

function httpsGetBuffer(
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

async function httpsGetJson<T>(url: string) {
	const response = await httpsGetBuffer(url)
	if (response.statusCode < 200 || response.statusCode >= 300) {
		throw new Error(`Yandex request failed: ${response.statusCode}`)
	}
	return JSON.parse(response.body.toString('utf8')) as T
}

function xmlDecode(value: string) {
	return value
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'")
		.replace(/&lt;/g, '<')
		.replace(/&gt;/g, '>')
		.replace(/&amp;/g, '&')
}

function stripXmlTags(value: string) {
	return xmlDecode(value.replace(/<[^>]*>/g, '')).trim()
}

function safeText(value: unknown) {
	return typeof value === 'string' ? value.trim() : ''
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
	return httpsGetJson<YandexDiskMetadata>(
		buildYandexUrl(YANDEX_PUBLIC_RESOURCES_URL, TOURNAMENT_PUBLIC_URL),
	)
}

async function fetchDownloadHref(publicKey: string) {
	const data = await httpsGetJson<YandexDownloadResponse>(
		buildYandexUrl(YANDEX_PUBLIC_DOWNLOAD_URL, publicKey),
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

function parseCellValue(cellXml: string, sharedStrings: string[]) {
	const type = cellXml.match(/\bt="([^"]+)"/)?.[1]
	const rawValue = cellXml.match(/<v>([\s\S]*?)<\/v>/)?.[1]

	if (type === 'inlineStr') {
		return stripXmlTags(cellXml.match(/<is>([\s\S]*?)<\/is>/)?.[1] ?? '')
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

function parseWorksheet(xml: string, sharedStrings: string[]) {
	const rows: unknown[][] = []

	for (const rowMatch of xml.matchAll(/<row\b[^>]*>([\s\S]*?)<\/row>/g)) {
		const rowXml = rowMatch[1] ?? ''
		const row: unknown[] = []

		for (const cellMatch of rowXml.matchAll(/<c\b([^>]*)>([\s\S]*?)<\/c>/g)) {
			const attrs = cellMatch[1] ?? ''
			const cellXml = cellMatch[0] ?? ''
			const ref = attrs.match(/\br="([^"]+)"/)?.[1] ?? ''
			const index = ref ? columnIndex(ref) : row.length
			row[index] = parseCellValue(cellXml, sharedStrings)
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

function parseRules(rows: unknown[][]) {
	const text = rows
		.flat()
		.map(safeText)
		.filter(value => value.length > 24)

	const rules = text.filter(
		value =>
			/каждую неделю|высоким процентом|отзыв|рекомендац/i.test(value) &&
			!/турнирная таблица/i.test(value),
	)

	return rules.length > 0 ? [...new Set(rules)] : FALLBACK_RULES
}

function parseJury(rows: unknown[][]) {
	const values = rows.flat().map(safeText)
	const juryCell = values.find(value => /жюри/i.test(value))
	if (!juryCell) return FALLBACK_JURY

	const [, rawJury = ''] = juryCell.split(/жюри\s*:?/i)
	const jury = rawJury
		.split(/[,;\n]/)
		.map(value => value.trim())
		.filter(Boolean)

	return jury.length > 0 ? jury : FALLBACK_JURY
}

function parseTournamentRows(sheetRows: unknown[][]) {
	const headerIndex = sheetRows.findIndex(row =>
		row.some(cell => /^офис$/i.test(safeText(cell))),
	)

	if (headerIndex < 0) {
		return {
			rows: assignRanks(FALLBACK_ROWS),
			weekLabels: Array.from({ length: 8 }, (_, index) => `Неделя ${index + 1}`),
		}
	}

	const headers = sheetRows[headerIndex].map(cell => safeText(cell))
	const officeColumn = headers.findIndex(header => /^офис$/i.test(header))
	const weekColumns = headers
		.map((header, index) => ({ header, index }))
		.filter(({ header }) => /^неделя\s+\d+/i.test(header))
	const attendanceColumn = headers.findIndex(header => /посещаем/i.test(header))
	const reviewColumn = headers.findIndex(header => /отзыв|рекомендац/i.test(header))
	const totalColumn = headers.findIndex(header => /итого/i.test(header))
	const percentColumn =
		headers.findIndex(header => /%|процент/i.test(header)) >= 0
			? headers.findIndex(header => /%|процент/i.test(header))
			: totalColumn >= 0
				? totalColumn + 1
				: -1

	const rows: Omit<TournamentOfficeRow, 'rank'>[] = []

	for (const sourceRow of sheetRows.slice(headerIndex + 1)) {
		const office = safeText(sourceRow[officeColumn])
		if (!office) {
			if (rows.length > 0) break
			continue
		}

		const total = cellNumber(sourceRow[totalColumn])
		const weekScores = weekColumns.map(({ index }) => cellNumber(sourceRow[index]))
		const attendanceScore = cellNumber(sourceRow[attendanceColumn])
		const reviewScore = cellNumber(sourceRow[reviewColumn])
		const computedTotal =
			weekScores.reduce<number>((sum, value) => sum + (value ?? 0), 0) +
			(attendanceScore ?? 0) +
			(reviewScore ?? 0)

		rows.push({
			id: officeId(office),
			office,
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

export async function getTournamentData(): Promise<TournamentData> {
	let metadata: YandexDiskMetadata

	try {
		metadata = await fetchYandexMetadata()
	} catch {
		metadata = {}
		return fallbackTournamentData(
			metadata,
			false,
			'Не удалось получить метаданные Yandex Disk с сервера, поэтому показан последний сохраненный снимок таблицы.',
		)
	}

	const publicKey = metadata.public_key || TOURNAMENT_PUBLIC_URL
	const downloadHref = await fetchDownloadHref(publicKey)

	if (!downloadHref) {
		return fallbackTournamentData(metadata, false)
	}

	try {
		const response = await httpsGetBuffer(downloadHref)
		if (response.statusCode < 200 || response.statusCode >= 300) {
			throw new Error(`Yandex XLSX download failed: ${response.statusCode}`)
		}

		const parsed = parseXlsx(response.body)

		return {
			title: 'Турнир между офисами',
			rows: parsed.rows,
			rules: parsed.rules,
			jury: parsed.jury,
			weekLabels: parsed.weekLabels,
			meta: buildMeta(metadata, true),
			sourceMode: 'xlsx',
			sourceWarning: null,
		}
	} catch {
		return fallbackTournamentData(
			metadata,
			true,
			'XLSX-файл доступен, но его не удалось разобрать. Показан последний сохраненный снимок таблицы.',
		)
	}
}
