'use client'

import { RefObject, useEffect, useRef } from 'react'

interface ReactHotkeyBinding {
	key: string
	enabled?: boolean
	preventDefault?: boolean | ((event: KeyboardEvent) => boolean)
	handler: (event: KeyboardEvent) => void
}

export function useReactHotkeys<T extends HTMLElement>(
	targetRef: RefObject<T | null>,
	bindings: ReactHotkeyBinding[],
) {
	const bindingsRef = useRef(bindings)

	useEffect(() => {
		bindingsRef.current = bindings
	}, [bindings])

	useEffect(() => {
		const target = targetRef.current
		if (!target) return

		function handleKeyDown(event: KeyboardEvent) {
			const binding = bindingsRef.current.find(
				item =>
					item.enabled !== false &&
					item.key.toLowerCase() === event.key.toLowerCase(),
			)
			if (!binding) return

			const shouldPrevent =
				typeof binding.preventDefault === 'function'
					? binding.preventDefault(event)
					: binding.preventDefault
			if (shouldPrevent) {
				event.preventDefault()
			}

			binding.handler(event)
		}

		target.addEventListener('keydown', handleKeyDown)
		return () => target.removeEventListener('keydown', handleKeyDown)
	}, [targetRef])
}
