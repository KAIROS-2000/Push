'use client'

import { useEffect, useState } from 'react'

const RU = 'ru-RU'

const VARIANT_OPTIONS = {
	chat: {
		day: '2-digit' as const,
		month: '2-digit' as const,
		hour: '2-digit' as const,
		minute: '2-digit' as const,
	},
	joinRequest: {
		day: '2-digit' as const,
		month: '2-digit' as const,
		hour: '2-digit' as const,
		minute: '2-digit' as const,
	},
	admin: { dateStyle: 'medium' as const, timeStyle: 'short' as const },
	tournament: {
		day: '2-digit' as const,
		month: 'long' as const,
		hour: '2-digit' as const,
		minute: '2-digit' as const,
	},
	submission: { dateStyle: 'medium' as const, timeStyle: 'short' as const },
	parentExpiry: { dateStyle: 'medium' as const, timeStyle: 'short' as const },
} satisfies Record<string, Intl.DateTimeFormatOptions>

export type UserLocalTimeVariant = keyof typeof VARIANT_OPTIONS

type UserLocalTimeProps = {
	iso: string | null | undefined
	variant: UserLocalTimeVariant
	emptyLabel?: string
	invalidLabel?: string
	className?: string
}

/**
 * Renders an instant from the API in the browser’s local timezone. Initial HTML avoids server
 * formatting so production Node (often UTC) does not leak into the visible clock.
 */
export function UserLocalTime({
	iso,
	variant,
	emptyLabel = '—',
	invalidLabel = '—',
	className,
}: UserLocalTimeProps) {
	const [text, setText] = useState('')

	const trimmed = iso == null ? '' : String(iso).trim()
	const shouldFormat = trimmed !== ''

	useEffect(() => {
		if (!shouldFormat) {
			setText('')
			return
		}
		const d = new Date(trimmed)
		if (Number.isNaN(d.getTime())) {
			setText(invalidLabel)
			return
		}
		setText(new Intl.DateTimeFormat(RU, VARIANT_OPTIONS[variant]).format(d))
	}, [invalidLabel, shouldFormat, trimmed, variant])

	if (!shouldFormat) {
		return <span className={className}>{emptyLabel}</span>
	}

	if (text === invalidLabel) {
		return <span className={className}>{invalidLabel}</span>
	}

	if (!text) {
		return <span className={className}>{'\u00a0'}</span>
	}

	return (
		<time dateTime={trimmed} className={className}>
			{text}
		</time>
	)
}
