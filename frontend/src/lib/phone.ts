/** Российский номер: храним и валидируем как 11 цифр, начинается с 7. */

export function normalizeRuPhoneInput(raw: string): string | null {
	const digits = raw.replace(/\D/g, '')
	if (!digits) return null
	let s = digits
	if (s.length === 11 && s[0] === '8') s = '7' + s.slice(1)
	if (s.length === 10) s = '7' + s
	if (s.length === 11 && s[0] === '7' && /^\d{11}$/.test(s)) return s
	return null
}

export function isValidRuPhone(normalized: string | null): boolean {
	if (!normalized || normalized.length !== 11) return false
	return /^7\d{10}$/.test(normalized)
}

/** Человекочитаемый вывод: +7 (912) 345-67-89 */
export function formatRuPhoneForDisplay(digits: string | null | undefined): string {
	if (!digits || digits.length !== 11 || !/^7\d{10}$/.test(digits)) {
		return ''
	}
	const a = digits.slice(1, 4)
	const b = digits.slice(4, 7)
	const c = digits.slice(7, 9)
	const d = digits.slice(9, 11)
	return `+7 (${a}) ${b}-${c}-${d}`
}
