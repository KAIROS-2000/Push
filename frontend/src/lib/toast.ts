'use client'

import { toast } from 'react-hot-toast'

export type AppToastTone = 'success' | 'error' | 'info'

function normalizeMessage(message: string) {
  return message.trim()
}

export function showSuccessToast(message: string) {
  const normalized = normalizeMessage(message)
  if (!normalized) return
  toast.success(normalized)
}

export function showErrorToast(message: string) {
  const normalized = normalizeMessage(message)
  if (!normalized) return
  toast.error(normalized)
}

export function showInfoToast(message: string) {
  const normalized = normalizeMessage(message)
  if (!normalized) return
  toast(normalized, {
    icon: 'i',
  })
}

export function showToastMessage(message: string, tone: AppToastTone = 'info') {
  if (tone === 'success') {
    showSuccessToast(message)
    return
  }

  if (tone === 'error') {
    showErrorToast(message)
    return
  }

  showInfoToast(message)
}
