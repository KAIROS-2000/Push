'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useGSAP } from '@gsap/react'
import gsap from 'gsap'
import { Bot, Send, Sparkles, X } from 'lucide-react'

import { api } from '@/lib/api'
import { LessonChatMessage, LessonGigaChatResponse } from '@/types'

gsap.registerPlugin(useGSAP)

type DrawerMessage = LessonChatMessage & {
  id: string
  persist?: boolean
}

function makeMessageId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID()
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function trimLabel(value: string, limit = 44) {
  return value.length > limit ? `${value.slice(0, Math.max(limit - 3, 0)).trimEnd()}...` : value
}

export function LessonGigachatDrawer({
  lessonId,
  lessonTitle,
  lessonSummary,
  moduleTitle,
  ageGroup,
  durationMinutes,
  theoryHighlights,
  interactiveHighlights,
  practiceTaskTitle,
  practiceTaskPrompt,
  quizTitle,
  draftAnswer,
}: {
  lessonId: number
  lessonTitle: string
  lessonSummary: string
  moduleTitle: string
  ageGroup?: string | null
  durationMinutes: number
  theoryHighlights: string[]
  interactiveHighlights: string[]
  practiceTaskTitle?: string
  practiceTaskPrompt?: string
  quizTitle?: string
  draftAnswer: string
}) {
  const [isOpen, setIsOpen] = useState(false)
  const [messages, setMessages] = useState<DrawerMessage[]>([])
  const [prompt, setPrompt] = useState('')
  const [error, setError] = useState('')
  const [isSending, setIsSending] = useState(false)
  const [modelLabel, setModelLabel] = useState('GigaChat')

  const panelRef = useRef<HTMLDivElement | null>(null)
  const overlayRef = useRef<HTMLButtonElement | null>(null)
  const buttonRef = useRef<HTMLButtonElement | null>(null)
  const inputRef = useRef<HTMLTextAreaElement | null>(null)
  const messagesEndRef = useRef<HTMLDivElement | null>(null)

  const welcomeMessages = useMemo<DrawerMessage[]>(
    () => [
      {
        id: makeMessageId(),
        role: 'assistant',
        persist: false,
        content: `Я рядом по уроку "${lessonTitle}". Могу объяснить тему простыми словами, сделать краткий конспект и помочь с практикой${practiceTaskTitle ? ` "${practiceTaskTitle}"` : ''}.`,
      },
    ],
    [lessonTitle, practiceTaskTitle]
  )

  const quickPrompts = useMemo(() => {
    const items = [
      'Объясни тему простыми словами',
      'Сделай мини-конспект по уроку',
      `Что самое важное в теме "${trimLabel(lessonTitle, 28)}"?`,
    ]

    if (practiceTaskTitle) {
      items.splice(1, 0, `Помоги начать "${trimLabel(practiceTaskTitle, 28)}"`)
    }

    if (draftAnswer.trim()) {
      items.push('Проверь мой текущий черновик')
    }

    if (theoryHighlights[0]) {
      items.push(`Объясни пункт "${trimLabel(theoryHighlights[0], 26)}"`)
    }

    return items
  }, [draftAnswer, lessonTitle, practiceTaskTitle, theoryHighlights])

  const lessonBadges = useMemo(() => {
    const items = [
      { label: 'Модуль', value: moduleTitle },
      { label: 'Возраст', value: ageGroup || 'middle' },
      { label: 'Длительность', value: `${durationMinutes} мин` },
    ]

    if (practiceTaskTitle) {
      items.push({ label: 'Практика', value: practiceTaskTitle })
    }

    return items
  }, [ageGroup, durationMinutes, moduleTitle, practiceTaskTitle])

  const lessonFocus = useMemo(() => {
    return Array.from(new Set([...theoryHighlights, ...interactiveHighlights]))
      .filter(Boolean)
      .slice(0, 4)
  }, [interactiveHighlights, theoryHighlights])

  useEffect(() => {
    setMessages(welcomeMessages)
    setPrompt('')
    setError('')
    setIsSending(false)
    setIsOpen(false)
    setModelLabel('GigaChat')
  }, [lessonId, welcomeMessages])

  useGSAP(() => {
    const panel = panelRef.current
    const overlay = overlayRef.current
    const trigger = buttonRef.current
    if (!panel || !overlay) return

    const setClosedState = () => {
      const isMobile = window.matchMedia('(max-width: 767px)').matches
      if (isMobile) {
        gsap.set(panel, { xPercent: 0, yPercent: 104 })
      } else {
        gsap.set(panel, { xPercent: 108, yPercent: 0 })
      }
    }

    setClosedState()
    gsap.set(overlay, { autoAlpha: 0, pointerEvents: 'none' })

    const floatTween = trigger
      ? gsap.to(trigger, {
          y: -6,
          duration: 1.8,
          repeat: -1,
          yoyo: true,
          ease: 'sine.inOut',
        })
      : null

    return () => {
      floatTween?.kill()
    }
  }, { dependencies: [lessonId] })

  useEffect(() => {
    const panel = panelRef.current
    const overlay = overlayRef.current
    if (!panel || !overlay) return

    const isMobile = window.matchMedia('(max-width: 767px)').matches
    const timeline = gsap.timeline({
      defaults: {
        ease: isOpen ? 'power3.out' : 'power2.inOut',
      },
    })

    if (isOpen) {
      gsap.set(overlay, { pointerEvents: 'auto' })
      timeline
        .to(overlay, { autoAlpha: 1, duration: 0.24 }, 0)
        .to(
          panel,
          {
            xPercent: 0,
            yPercent: 0,
            duration: isMobile ? 0.42 : 0.48,
          },
          0
        )
    } else {
      timeline
        .to(overlay, {
          autoAlpha: 0,
          duration: 0.2,
          onComplete: () => {
            gsap.set(overlay, { pointerEvents: 'none' })
          },
        }, 0)
        .to(
          panel,
          {
            xPercent: isMobile ? 0 : 108,
            yPercent: isMobile ? 104 : 0,
            duration: isMobile ? 0.34 : 0.38,
          },
          0
        )
    }

    return () => {
      timeline.kill()
    }
  }, [isOpen])

  useEffect(() => {
    if (!isOpen) return
    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const timeout = window.setTimeout(() => inputRef.current?.focus(), 260)
    return () => {
      document.body.style.overflow = previousOverflow
      window.clearTimeout(timeout)
    }
  }, [isOpen])

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth', block: 'end' })
  }, [isOpen, isSending, messages])

  useEffect(() => {
    if (!isOpen) return
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
      }
    }
    window.addEventListener('keydown', handleEscape)
    return () => window.removeEventListener('keydown', handleEscape)
  }, [isOpen])

  async function sendMessage(rawText?: string) {
    const content = (rawText ?? prompt).trim()
    if (!content || isSending) return

    const userMessage: DrawerMessage = {
      id: makeMessageId(),
      role: 'user',
      content,
    }

    const nextMessages = [...messages, userMessage]
    const apiHistory: LessonChatMessage[] = nextMessages
      .filter((item) => item.persist !== false)
      .map(({ role, content: messageContent }) => ({ role, content: messageContent }))

    setMessages(nextMessages)
    setPrompt('')
    setError('')
    setIsSending(true)

    try {
      const data = await api<LessonGigaChatResponse>(
        `/lessons/${lessonId}/gigachat`,
        {
          method: 'POST',
          body: JSON.stringify({
            messages: apiHistory,
            current_answer: draftAnswer,
          }),
        },
        true
      )

      setModelLabel(data.model || 'GigaChat')
      setMessages((current) => [
        ...current,
        {
          id: makeMessageId(),
          role: 'assistant',
          content: data.message.content,
        },
      ])
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Не удалось получить ответ от GigaChat.')
    } finally {
      setIsSending(false)
    }
  }

  return (
    <>
      <button
        ref={overlayRef}
        type="button"
        aria-label="Закрыть GigaChat"
        onClick={() => setIsOpen(false)}
        className="lesson-chat-overlay fixed inset-0 z-40 bg-slate-950/40 opacity-0"
      />

      <aside
        ref={panelRef}
        className="lesson-chat-panel fixed bottom-0 left-0 right-0 z-50 flex h-[82dvh] max-h-[860px] flex-col overflow-hidden rounded-t-[30px] border border-white/80 bg-white/95 shadow-[0_-24px_80px_rgba(15,23,42,0.2)] backdrop-blur-xl md:inset-y-0 md:left-auto md:right-0 md:h-dvh md:w-[460px] md:max-h-none md:max-w-[460px] md:rounded-none md:border-y-0 md:border-r-0 md:border-l"
      >
        <div className="lesson-chat-header border-b border-slate-200/80 bg-[linear-gradient(135deg,rgba(14,165,233,0.14),rgba(34,197,94,0.1))] px-4 py-4 md:px-5">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <div className="lesson-chat-badge flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white shadow-lg shadow-sky-200/70">
                <Bot className="size-5" />
              </div>
              <div className="min-w-0">
                <p className="text-xs font-black uppercase tracking-[0.2em] text-sky-700">{modelLabel}</p>
                <h3 className="truncate text-lg font-black text-slate-900">Помощник по уроку</h3>
              </div>
            </div>

            <button
              type="button"
              onClick={() => setIsOpen(false)}
              className="lesson-chat-close flex size-10 items-center justify-center rounded-full bg-white/80 text-slate-700 transition hover:bg-slate-900 hover:text-white"
            >
              <X className="size-5" />
            </button>
          </div>

          <p className="text-sm leading-6 text-slate-600">
            {lessonSummary}
          </p>

          <div className="mt-4 flex gap-2 overflow-x-auto pb-1 scrollbar-hidden">
            {quickPrompts.map((item) => (
              <button
                key={item}
                type="button"
                onClick={() => {
                  setIsOpen(true)
                  void sendMessage(item)
                }}
                className="lesson-chat-chip shrink-0 rounded-full border border-sky-200 bg-white/90 px-4 py-2 text-left text-xs font-bold text-sky-700 transition hover:border-slate-900 hover:bg-slate-900 hover:text-white"
              >
                {item}
              </button>
            ))}
          </div>
        </div>

        <div className="lesson-chat-body flex min-h-0 flex-1 flex-col bg-[radial-gradient(circle_at_top,rgba(14,165,233,0.07),transparent_34%),linear-gradient(180deg,rgba(248,250,252,0.94),rgba(241,245,249,0.95))]">
          <div className="scrollbar-hidden flex-1 space-y-4 overflow-y-auto px-4 py-4 md:px-5">
            <section className="rounded-[24px] border border-white/80 bg-white/90 p-4 shadow-sm">
              <p className="text-[11px] font-black uppercase tracking-[0.18em] text-slate-500">
                Надстройка по уроку
              </p>

              <div className="mt-3 flex flex-wrap gap-2">
                {lessonBadges.map((item) => (
                  <span
                    key={`${item.label}-${item.value}`}
                    className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-700"
                  >
                    {item.label}: {trimLabel(item.value, 34)}
                  </span>
                ))}
              </div>

              {lessonFocus.length > 0 && (
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-black uppercase tracking-[0.16em] text-sky-700">
                    Опорные пункты
                  </p>
                  {lessonFocus.map((item) => (
                    <div
                      key={item}
                      className="rounded-[18px] bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700"
                    >
                      {item}
                    </div>
                  ))}
                </div>
              )}

              {practiceTaskPrompt && (
                <div className="mt-4 rounded-[20px] bg-slate-900 px-4 py-3 text-sm text-slate-100">
                  <p className="text-[11px] font-black uppercase tracking-[0.16em] text-sky-300">
                    Что сейчас делаем
                  </p>
                  <p className="mt-1 leading-6 text-slate-200">
                    {trimLabel(practiceTaskPrompt, 220)}
                  </p>
                </div>
              )}

              {quizTitle && (
                <p className="mt-4 text-sm leading-6 text-slate-600">
                  После практики можно подготовиться к квизу:{' '}
                  <span className="font-semibold text-slate-900">{quizTitle}</span>
                </p>
              )}

              {draftAnswer.trim() && (
                <p className="mt-3 text-sm leading-6 text-emerald-700">
                  Черновик ответа уже есть, значит можно попросить GigaChat проверить его и подсказать, что улучшить.
                </p>
              )}
            </section>

            {messages.map((message) => (
              <div
                key={message.id}
                className={`max-w-[92%] rounded-[24px] px-4 py-3 text-sm leading-7 shadow-sm ${
                  message.role === 'assistant'
                    ? 'lesson-chat-assistant border border-white/80 bg-white text-slate-700'
                    : 'lesson-chat-user ml-auto bg-slate-900 text-white'
                }`}
              >
                <p className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] opacity-60">
                  {message.role === 'assistant' ? 'GigaChat' : 'Вы'}
                </p>
                <p className="whitespace-pre-wrap">{message.content}</p>
              </div>
            ))}

            {isSending && (
              <div className="lesson-chat-assistant max-w-[88%] rounded-[24px] border border-white/80 bg-white px-4 py-3 text-sm text-slate-600 shadow-sm">
                <p className="mb-1 text-[11px] font-black uppercase tracking-[0.18em] opacity-60">GigaChat</p>
                <div className="flex items-center gap-2">
                  <span className="size-2 rounded-full bg-sky-500 animate-pulse" />
                  <span className="size-2 rounded-full bg-sky-500/80 animate-pulse [animation-delay:120ms]" />
                  <span className="size-2 rounded-full bg-sky-500/60 animate-pulse [animation-delay:240ms]" />
                </div>
              </div>
            )}

            <div ref={messagesEndRef} />
          </div>

          <div className="lesson-chat-composer mt-auto border-t border-slate-200/80 bg-white/92 px-4 pb-4 pt-3 md:px-5 md:pb-5">
            {error && (
              <div className="mb-3 rounded-[20px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
                {error}
              </div>
            )}

            <div className="lesson-chat-input-shell rounded-[26px] border border-slate-200 bg-slate-50 p-2 shadow-[inset_0_1px_0_rgba(255,255,255,0.7)]">
              <textarea
                ref={inputRef}
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault()
                    void sendMessage()
                  }
                }}
                placeholder="Спроси про теорию, разбор или свою практику..."
                className="h-24 w-full resize-none bg-transparent px-3 py-2 text-sm leading-6 text-slate-800 placeholder:text-slate-400"
              />

              <div className="flex items-center justify-between gap-3 px-2 pb-1">
                <div className="flex items-center gap-2 text-xs font-semibold text-slate-500">
                  <Sparkles className="size-4 text-sky-600" />
                  <span>Учитывает контекст текущего урока</span>
                </div>

                <button
                  type="button"
                  disabled={isSending || !prompt.trim()}
                  onClick={() => void sendMessage()}
                  className="lesson-chat-send inline-flex items-center gap-2 rounded-full bg-slate-900 px-4 py-2 text-sm font-semibold text-white transition hover:-translate-y-0.5 disabled:translate-y-0 disabled:opacity-50"
                >
                  <Send className="size-4" />
                  Отправить
                </button>
              </div>
            </div>
          </div>
        </div>
      </aside>

      <button
        ref={buttonRef}
        type="button"
        onClick={() => setIsOpen(true)}
        className={`lesson-chat-trigger fixed bottom-4 right-4 z-30 inline-flex items-center gap-3 rounded-full border border-white/80 bg-slate-900 px-4 py-3 text-sm font-semibold text-white shadow-[0_18px_45px_rgba(15,23,42,0.22)] transition md:bottom-6 md:right-6 md:px-5 ${
          isOpen ? 'pointer-events-none translate-x-6 opacity-0' : 'hover:-translate-y-0.5 opacity-100'
        }`}
      >
        <span className="flex size-10 items-center justify-center rounded-full bg-white/14">
          <Bot className="size-5" />
        </span>
        <span className="max-w-[150px] leading-5 text-left sm:max-w-none">
          Спросить GigaChat
        </span>
      </button>
    </>
  )
}
