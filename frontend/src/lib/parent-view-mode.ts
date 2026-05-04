// Persistence helpers for the parent cabinet "simple / extended" view mode (P3b).
// Storage choice (localStorage) is deliberate — per-device preference, no server roundtrip.
//
// SSR note: every export is guarded for `typeof window === 'undefined'`. Initial hydration
// will momentarily render the default mode ('simple') before the effect rehydrates from
// localStorage; that is acceptable because the toggle only hides advanced sections, not the
// shell — there is no visible content shift in the simple→simple case.

export type ParentViewMode = 'simple' | 'extended'

export const PARENT_VIEW_MODE_STORAGE_KEY = 'codequest_parent_view_mode'
export const DEFAULT_PARENT_VIEW_MODE: ParentViewMode = 'simple'
export const PARENT_VIEW_MODE_CHANGE_EVENT = 'progyx:parent-view-mode-change'

const ALL_MODES: ParentViewMode[] = ['simple', 'extended']

export function isParentViewMode(value: unknown): value is ParentViewMode {
	return typeof value === 'string' && (ALL_MODES as string[]).includes(value)
}

export function resolveParentViewMode(
	value: unknown,
	fallback: ParentViewMode = DEFAULT_PARENT_VIEW_MODE,
): ParentViewMode {
	return isParentViewMode(value) ? value : fallback
}

export function getStoredParentViewMode(): ParentViewMode | null {
	if (typeof window === 'undefined') return null
	try {
		const raw = window.localStorage.getItem(PARENT_VIEW_MODE_STORAGE_KEY)
		return isParentViewMode(raw) ? raw : null
	} catch {
		// Some browsers (private mode / disabled storage) throw on access.
		return null
	}
}

export function persistParentViewMode(mode: ParentViewMode): void {
	if (typeof window === 'undefined') return
	try {
		window.localStorage.setItem(PARENT_VIEW_MODE_STORAGE_KEY, mode)
		window.dispatchEvent(
			new CustomEvent<ParentViewMode>(PARENT_VIEW_MODE_CHANGE_EVENT, { detail: mode }),
		)
	} catch {
		// Persisting is best-effort: if storage is unavailable, the in-memory state
		// still works for the current tab.
	}
}
