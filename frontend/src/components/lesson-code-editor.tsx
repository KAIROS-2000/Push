'use client'

import Editor, { loader } from '@monaco-editor/react'
import type * as MonacoNamespace from 'monaco-editor'
import type { editor } from 'monaco-editor'
import { useEffect, useMemo, useRef, useState } from 'react'

import { useAppTheme } from '@/hooks/use-app-theme'

let monacoLoaderPromise: Promise<void> | null = null
const MONACO_THEME_LIGHT = 'proghub-light'
const MONACO_THEME_DARK = 'proghub-dark'

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

function defineEditorThemes(monaco: typeof MonacoNamespace) {
  monaco.editor.defineTheme(MONACO_THEME_LIGHT, {
    base: 'vs',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '64748B', fontStyle: 'italic' },
      { token: 'keyword', foreground: '1D4ED8', fontStyle: 'bold' },
      { token: 'string', foreground: '047857' },
      { token: 'number', foreground: '7C3AED' },
      { token: 'delimiter.bracket', foreground: '0F172A' },
    ],
    colors: {
      'editor.background': '#F8FBFF',
      'editor.foreground': '#0F172A',
      'editorCursor.foreground': '#2563EB',
      'editor.lineHighlightBackground': '#EEF5FF',
      'editorLineNumber.foreground': '#94A3B8',
      'editorLineNumber.activeForeground': '#0F172A',
      'editor.selectionBackground': '#BFDBFE66',
      'editor.inactiveSelectionBackground': '#DBEAFE66',
      'editorIndentGuide.background1': '#D7E3F4',
      'editorIndentGuide.activeBackground1': '#60A5FA',
      'editorBracketMatch.background': '#DBEAFE66',
      'editorBracketMatch.border': '#60A5FA',
      'editorWidget.background': '#FFFFFF',
      'editorWidget.border': '#D6E4FF',
      'editorHoverWidget.background': '#FFFFFF',
      'editorHoverWidget.border': '#D6E4FF',
      'editorSuggestWidget.background': '#FFFFFF',
      'editorSuggestWidget.foreground': '#0F172A',
      'editorSuggestWidget.border': '#D6E4FF',
      'editorSuggestWidget.selectedBackground': '#EFF6FF',
      'focusBorder': '#60A5FA',
    },
  })

  monaco.editor.defineTheme(MONACO_THEME_DARK, {
    base: 'vs-dark',
    inherit: true,
    rules: [
      { token: 'comment', foreground: '8B9BB4', fontStyle: 'italic' },
      { token: 'keyword', foreground: '7DD3FC', fontStyle: 'bold' },
      { token: 'string', foreground: '86EFAC' },
      { token: 'number', foreground: 'C4B5FD' },
      { token: 'delimiter.bracket', foreground: 'E2E8F0' },
    ],
    colors: {
      'editor.background': '#0B1220',
      'editor.foreground': '#E2E8F0',
      'editorCursor.foreground': '#38BDF8',
      'editor.lineHighlightBackground': '#111B31',
      'editorLineNumber.foreground': '#64748B',
      'editorLineNumber.activeForeground': '#E2E8F0',
      'editor.selectionBackground': '#1D4ED866',
      'editor.inactiveSelectionBackground': '#1E293B99',
      'editorIndentGuide.background1': '#23314D',
      'editorIndentGuide.activeBackground1': '#60A5FA',
      'editorBracketMatch.background': '#1D4ED855',
      'editorBracketMatch.border': '#38BDF8',
      'editorWidget.background': '#0F172A',
      'editorWidget.border': '#1E3A5F',
      'editorHoverWidget.background': '#0F172A',
      'editorHoverWidget.border': '#1E3A5F',
      'editorSuggestWidget.background': '#0F172A',
      'editorSuggestWidget.foreground': '#E2E8F0',
      'editorSuggestWidget.border': '#1E3A5F',
      'editorSuggestWidget.selectedBackground': '#172554',
      'focusBorder': '#38BDF8',
    },
  })
}

async function formatEditor(editorInstance: editor.IStandaloneCodeEditor | null) {
  if (!editorInstance) return
  const action = editorInstance.getAction('editor.action.formatDocument')
  if (!action) return
  await action.run()
}

function layoutMonacoToHost(
  ed: editor.IStandaloneCodeEditor,
  host: HTMLDivElement | null,
) {
  if (!host) {
    ed.layout()
    return
  }
  const { width, height } = host.getBoundingClientRect()
  const w = Math.max(0, Math.floor(width))
  const h = Math.max(0, Math.floor(height))
  if (w > 0 && h > 0) {
    ed.layout({ width: w, height: h })
  } else {
    ed.layout()
  }
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
  const [isFocused, setIsFocused] = useState(false)
  const [copyState, setCopyState] = useState<'idle' | 'done' | 'failed'>('idle')
  const theme = useAppTheme()
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null)
  const copyResetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const monacoTheme = theme === 'dark' ? MONACO_THEME_DARK : MONACO_THEME_LIGHT
  const fileExtension = language === 'python' ? 'py' : 'js'
  const fileName = `solution.${fileExtension}`
  const supportsFormatting = language === 'javascript'
  const shellClass =
    theme === 'dark'
      ? 'border-slate-700/80 bg-slate-950/90 shadow-[0_20px_48px_rgba(2,6,23,0.45)]'
      : 'border-slate-200/90 bg-white/95 shadow-[0_20px_40px_rgba(15,23,42,0.08)]'
  const surfaceClass =
    theme === 'dark'
      ? 'bg-[#0b1220] text-slate-400'
      : 'bg-[#f8fbff] text-slate-500'
  const errorSurfaceClass =
    theme === 'dark'
      ? 'bg-[#0b1220] text-rose-300'
      : 'bg-[#f8fbff] text-rose-600'
  const toolbarClass =
    theme === 'dark'
      ? 'border-slate-800 bg-slate-950/70'
      : 'border-slate-200/80 bg-white/90'
  const chipClass =
    theme === 'dark'
      ? 'border-slate-700 bg-slate-900/80 text-slate-200'
      : 'border-slate-200 bg-white text-slate-700'
  const secondaryChipClass =
    theme === 'dark'
      ? 'border-sky-900/70 bg-sky-950/60 text-sky-200'
      : 'border-sky-200 bg-sky-50 text-sky-700'
  const actionClass =
    theme === 'dark'
      ? 'border-slate-700 bg-slate-900/80 text-slate-100 hover:border-sky-500/60 hover:text-sky-200'
      : 'border-slate-200 bg-white text-slate-700 hover:border-sky-300 hover:text-sky-700'
  const shellFocusClass = isFocused
    ? theme === 'dark'
      ? 'ring-2 ring-sky-400/50'
      : 'ring-2 ring-sky-300/70'
    : ''
  const lineCount = useMemo(() => value.split(/\r?\n/).length, [value])
  const editorHostRef = useRef<HTMLDivElement | null>(null)
  const layoutObserverRef = useRef<ResizeObserver | null>(null)
  const contentLayoutRafRef = useRef<number | null>(null)
  const layoutDisposablesRef = useRef<Array<{ dispose: () => void }>>([])
  const editorOptions = useMemo<editor.IStandaloneEditorConstructionOptions>(
    () => ({
      automaticLayout: true,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      overviewRulerBorder: false,
      overviewRulerLanes: 0,
      hideCursorInOverviewRuler: true,
      glyphMargin: false,
      lineNumbersMinChars: 3,
      lineDecorationsWidth: 0,
      renderLineHighlight: 'all',
      smoothScrolling: true,
      cursorBlinking: 'smooth',
      cursorSmoothCaretAnimation: 'on',
      cursorSurroundingLines: 3,
      fontSize: 14,
      fontFamily:
        "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace",
      fontLigatures: false,
      tabSize: language === 'python' ? 4 : 2,
      insertSpaces: true,
      detectIndentation: false,
      formatOnPaste: true,
      formatOnType: true,
      quickSuggestions: {
        comments: 'on',
        other: 'on',
        strings: 'on',
      },
      quickSuggestionsDelay: 100,
      suggestOnTriggerCharacters: true,
      acceptSuggestionOnCommitCharacter: true,
      acceptSuggestionOnEnter: 'on',
      tabCompletion: 'on',
      snippetSuggestions: 'inline',
      selectionHighlight: true,
      occurrencesHighlight: 'singleFile',
      matchBrackets: 'always',
      guides: {
        bracketPairs: true,
        highlightActiveBracketPair: true,
        indentation: true,
      },
      bracketPairColorization: {
        enabled: true,
        independentColorPoolPerBracketType: true,
      },
      stickyScroll: {
        enabled: true,
        maxLineCount: 2,
      },
      wordWrap: 'on',
      wrappingIndent: 'indent',
      folding: true,
      foldingHighlight: true,
      showFoldingControls: 'mouseover',
      padding: {
        top: 0,
        bottom: 0,
      },
      scrollbar: {
        verticalScrollbarSize: 10,
        horizontalScrollbarSize: 10,
        useShadows: false,
        alwaysConsumeMouseWheel: false,
      },
    }),
    [language],
  )

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

  useEffect(() => {
    return () => {
      if (copyResetTimerRef.current) {
        clearTimeout(copyResetTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!isReady) return
    requestAnimationFrame(() => {
      const ed = editorRef.current
      if (!ed) return
      layoutMonacoToHost(ed, editorHostRef.current)
    })
  }, [isReady, theme])

  useEffect(() => {
    return () => {
      if (contentLayoutRafRef.current !== null) {
        cancelAnimationFrame(contentLayoutRafRef.current)
        contentLayoutRafRef.current = null
      }
      for (const disposable of layoutDisposablesRef.current) {
        disposable.dispose()
      }
      layoutDisposablesRef.current = []
      layoutObserverRef.current?.disconnect()
      layoutObserverRef.current = null
    }
  }, [])

  function handleBeforeMount(monaco: typeof MonacoNamespace) {
    defineEditorThemes(monaco)
  }

  function handleMount(
    ed: editor.IStandaloneCodeEditor,
    monaco: typeof MonacoNamespace,
  ) {
    editorRef.current = ed
    for (const disposable of layoutDisposablesRef.current) {
      disposable.dispose()
    }
    layoutDisposablesRef.current = []

    defineEditorThemes(monaco)
    if (language === 'javascript') {
      ed.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void formatEditor(ed)
      })
    }
    ed.onDidFocusEditorText(() => setIsFocused(true))
    ed.onDidBlurEditorText(() => setIsFocused(false))
    const layoutFromHost = () => layoutMonacoToHost(ed, editorHostRef.current)
    const scheduleLayout = () => {
      requestAnimationFrame(() => layoutFromHost())
    }
    const scheduleContentLayout = () => {
      if (contentLayoutRafRef.current !== null) return
      contentLayoutRafRef.current = requestAnimationFrame(() => {
        contentLayoutRafRef.current = null
        layoutFromHost()
      })
    }
    scheduleLayout()
    layoutDisposablesRef.current.push(
      ed.onDidChangeModelContent(() => scheduleContentLayout()),
    )
    if (editorHostRef.current && typeof ResizeObserver !== 'undefined') {
      layoutObserverRef.current?.disconnect()
      const ro = new ResizeObserver(() => {
        requestAnimationFrame(() => layoutFromHost())
      })
      ro.observe(editorHostRef.current)
      layoutObserverRef.current = ro
    }
    for (const delay of [0, 80, 200, 400, 700]) {
      window.setTimeout(() => {
        requestAnimationFrame(() => layoutFromHost())
      }, delay)
    }
  }

  async function handleCopy() {
    try {
      await navigator.clipboard.writeText(editorRef.current?.getValue() || value)
      setCopyState('done')
    } catch {
      setCopyState('failed')
    }

    if (copyResetTimerRef.current) {
      clearTimeout(copyResetTimerRef.current)
    }

    copyResetTimerRef.current = setTimeout(() => {
      setCopyState('idle')
    }, 1800)
  }

  if (error) {
    return (
      <div
        className={`h-[420px] w-full rounded-[24px] border p-3 transition-shadow ${shellClass}`}
      >
        <div
          className={`flex h-full items-center justify-center rounded-[20px] px-4 text-center text-sm font-medium ${errorSurfaceClass}`}
        >
          {error}
        </div>
      </div>
    )
  }

  if (!isReady) {
    return (
      <div
        className={`h-[420px] w-full rounded-[24px] border p-3 transition-shadow ${shellClass}`}
      >
        <div
          className={`flex h-full items-center justify-center rounded-[20px] text-sm font-medium ${surfaceClass}`}
        >
          Загружаем редактор…
        </div>
      </div>
    )
  }

  return (
    <div
      className={`h-[420px] w-full rounded-[24px] border p-3 transition-[box-shadow] ${shellClass} ${shellFocusClass}`}
    >
      <div
        className={`flex h-full min-h-0 w-full min-w-0 flex-col overflow-hidden rounded-[20px] ${surfaceClass}`}
      >
        <div
          className={`relative z-20 flex w-full min-w-0 flex-none flex-col gap-2 border-b px-3 py-2.5 sm:px-4 ${toolbarClass}`}
        >
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <div className="min-w-0">
              <span
                className={`inline-block max-w-full truncate rounded-full border px-2.5 py-1 text-[0.7rem] font-bold uppercase leading-none tracking-tight sm:px-3 sm:tracking-[0.12em] ${chipClass}`}
                title={fileName}
              >
                {fileName}
              </span>
            </div>
            <span
              className={`inline-flex shrink-0 items-center rounded-full border px-2.5 py-1 text-xs font-semibold sm:px-3 ${secondaryChipClass}`}
            >
              {language === 'python' ? 'Python' : 'JavaScript'}
            </span>
          </div>
          <div className="flex w-full min-w-0 items-center justify-between gap-2">
            <span className="shrink-0 text-[0.7rem] font-medium text-slate-500 sm:text-xs">
              Строк: {lineCount}
            </span>
            {supportsFormatting && (
              <span className="hidden min-w-0 text-[0.7rem] text-slate-500 sm:inline sm:text-xs">
                Ctrl/Cmd+S — формат
              </span>
            )}
            <div className="ml-auto flex shrink-0 flex-wrap items-center justify-end gap-1.5 sm:gap-2">
              {supportsFormatting && (
                <button
                  type="button"
                  onClick={() => void formatEditor(editorRef.current)}
                  className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold sm:px-3 sm:py-1.5 sm:text-xs ${actionClass}`}
                >
                  Формат
                </button>
              )}
              <button
                type="button"
                onClick={() => void handleCopy()}
                className={`rounded-full border px-2.5 py-1 text-[0.7rem] font-semibold sm:px-3 sm:py-1.5 sm:text-xs ${actionClass}`}
              >
                {copyState === 'done'
                  ? 'Скопировано'
                  : copyState === 'failed'
                    ? 'Ошибка'
                    : 'Копия'}
              </button>
            </div>
          </div>
        </div>
        <div ref={editorHostRef} className="relative z-0 min-h-0 w-full min-w-0 flex-1">
          <div className="absolute inset-0 z-0 min-h-0 min-w-0">
            <Editor
              className="block h-full w-full min-w-0"
              width="100%"
              height="100%"
              path={fileName}
              language={language}
              value={value}
              onChange={(nextValue) => onChange(nextValue || '')}
              beforeMount={handleBeforeMount}
              onMount={handleMount}
              loading={
                <div className={`flex h-full w-full items-center justify-center text-sm font-medium ${surfaceClass}`}>
                  Загружаем редактор…
                </div>
              }
              theme={monacoTheme}
              options={editorOptions}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
