'use client'

import { Toaster } from 'react-hot-toast'

import { useAppTheme } from '@/hooks/use-app-theme'

export function AppToaster() {
  const theme = useAppTheme()
  const isDark = theme === 'dark'

  return (
    <Toaster
      position="top-right"
      gutter={12}
      containerStyle={{
        top: 18,
        right: 18,
        left: 18,
      }}
      toastOptions={{
        duration: 3600,
        style: {
          background: isDark ? 'rgba(15, 23, 42, 0.96)' : 'rgba(255, 255, 255, 0.96)',
          color: isDark ? '#e2e8f0' : '#0f172a',
          border: isDark ? '1px solid rgba(148, 163, 184, 0.18)' : '1px solid rgba(148, 163, 184, 0.24)',
          borderRadius: '20px',
          boxShadow: isDark
            ? '0 18px 48px rgba(2, 6, 23, 0.5)'
            : '0 18px 48px rgba(15, 23, 42, 0.14)',
          maxWidth: 'min(92vw, 28rem)',
          padding: '14px 16px',
        },
        success: {
          iconTheme: {
            primary: '#16a34a',
            secondary: '#f8fafc',
          },
        },
        error: {
          iconTheme: {
            primary: '#dc2626',
            secondary: '#f8fafc',
          },
        },
      }}
    />
  )
}
