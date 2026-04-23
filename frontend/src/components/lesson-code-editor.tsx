'use client'

import Editor, { loader } from '@monaco-editor/react'
import { useEffect, useState } from 'react'

import { useAppTheme } from '@/hooks/use-app-theme'

let monacoLoaderPromise: Promise<void> | null = null
const EDITOR_HEIGHT = 'min(360px, 48vh)'

function initializeMonacoLoader() {
  if (!monacoLoaderPromise) {
    monacoLoaderPromise = import('monaco-editor')
      .then((monaco) => {
        loader.config({ monaco })
      })
      .catch((error) => {
        monacoLoaderPromise = null
        throw error
      })
  }

  return monacoLoaderPromise
}

export function LessonCodeEditor({
  language,
  value,
  onChange,
}: {
  language: 'javascript' | 'python'
  value: string
  onChange: (value: string) => void
}) {
  const [isReady, setIsReady] = useState(false)
  const [error, setError] = useState('')
  const theme = useAppTheme()

  useEffect(() => {
    let isActive = true

    initializeMonacoLoader()
      .then(() => {
        if (isActive) {
          setIsReady(true)
        }
      })
      .catch((initializationError) => {
        if (isActive) {
          setError(initializationError instanceof Error ? initializationError.message : 'Не удалось загрузить редактор.')
        }
      })

    return () => {
      isActive = false
    }
  }, [])

  if (error) {
    return (
      <div className="flex items-center justify-center bg-slate-50 px-4 text-center text-sm font-medium text-rose-600" style={{ height: EDITOR_HEIGHT }}>
        {error}
      </div>
    )
  }

  if (!isReady) {
    return (
      <div className="flex items-center justify-center bg-slate-50 text-sm font-medium text-slate-500" style={{ height: EDITOR_HEIGHT }}>
        Загружаем редактор…
      </div>
    )
  }

  return (
    <Editor
      height={EDITOR_HEIGHT}
      language={language}
      value={value}
      onChange={(nextValue) => onChange(nextValue || '')}
      loading={
        <div className="flex items-center justify-center bg-slate-50 text-sm font-medium text-slate-500" style={{ height: EDITOR_HEIGHT }}>
          Загружаем редактор…
        </div>
      }
      theme={theme === 'dark' ? 'vs-dark' : 'vs-light'}
    />
  )
}
