'use client'

import { UserLocalTime } from '@/components/user-local-time'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { Loader2, Send, X } from 'lucide-react'
import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'

type MessageRow = {
  id: number
  body: string
  created_at: string
  sender_id: number
  sender_name?: string | null
  sender_role?: string | null
}

type ThreadInfo = {
  id?: number
  teacher?: { name?: string | null }
  classroom?: { name?: string | null }
  child?: { name?: string | null }
}

export function ParentTeacherChatPanel({
  threadId,
  currentUserId,
  canMessage,
  title,
  onClose,
  onSent,
}: {
  threadId: number
  currentUserId: number
  canMessage: boolean
  title: string
  onClose: () => void
  onSent: () => void
}) {
  const [thread, setThread] = useState<ThreadInfo | null>(null)
  const [messages, setMessages] = useState<MessageRow[]>([])
  const [loading, setLoading] = useState(true)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState('')
  const [draft, setDraft] = useState('')
  const mounted = useRef(true)
  const onSentRef = useRef(onSent)
  onSentRef.current = onSent
  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const d = await api<{
        thread?: ThreadInfo
        messages: MessageRow[]
      }>(`/parent/messaging/threads/${threadId}/messages`, undefined, 'required')
      if (!mounted.current) return
      setThread(d.thread ?? null)
      setMessages(Array.isArray(d.messages) ? d.messages : [])
      try {
        await api(`/parent/messaging/threads/${threadId}/read`, { method: 'POST', body: '{}' }, 'required')
        onSentRef.current()
      } catch {
        // ignore read errors
      }
    } catch (e) {
      if (mounted.current) setError(getApiErrorMessage(e, 'Не удалось загрузить сообщения.'))
    } finally {
      if (mounted.current) setLoading(false)
    }
  }, [threadId])

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
    }
  }, [load])

  async function send(e: FormEvent) {
    e.preventDefault()
    if (!canMessage) return
    const body = draft.trim()
    if (!body) return
    setSending(true)
    setError('')
    try {
      await api(
        `/parent/messaging/threads/${threadId}/messages`,
        { method: 'POST', body: JSON.stringify({ body }) },
        'required',
      )
      setDraft('')
      showSuccessToast('Сообщение отправлено.')
      await load()
      onSent()
    } catch (err) {
      const m = getApiErrorMessage(err, 'Не удалось отправить.')
      setError(m)
      showErrorToast(m)
    } finally {
      setSending(false)
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-label="Чат с педагогом"
      onClick={e => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div
        className="flex max-h-[min(100dvh,720px)] w-full max-w-lg flex-col rounded-t-2xl bg-white shadow-xl sm:rounded-2xl"
        onClick={e => e.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-2 border-b border-slate-100 p-4">
          <div className="min-w-0">
            <p className="text-xs font-bold uppercase text-slate-500">Сообщения</p>
            <h2 className="mt-1 break-words text-lg font-black text-slate-900">{title}</h2>
            {thread?.child?.name ? (
              <p className="text-xs text-slate-500">Ребёнок: {thread.child.name}</p>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="messaging-icon-button shrink-0" aria-label="Закрыть">
            <X size={20} />
          </button>
        </header>
        {!canMessage ? (
          <p className="px-4 py-3 text-sm text-amber-800">
            Связь с педагогом отключена в настройках согласия (блок «Согласия» ниже).
          </p>
        ) : null}
        {error ? <p className="px-4 text-sm text-rose-700">{error}</p> : null}
        <div className="min-h-0 flex-1 space-y-3 overflow-y-auto px-4 py-3 text-sm">
          {loading ? (
            <div className="flex items-center justify-center gap-2 py-8 text-slate-500">
              <Loader2 className="animate-spin" size={20} />
              Загрузка…
            </div>
          ) : (
            messages.map(m => {
              const own = m.sender_id === currentUserId
              return (
                <div
                  key={m.id}
                  className={`max-w-[90%] rounded-2xl px-3 py-2 ${own ? 'ml-auto bg-sky-100 text-slate-900' : 'bg-slate-100 text-slate-800'}`}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {m.sender_name || (own ? 'Вы' : 'Педагог')} ·{' '}
                    <UserLocalTime iso={m.created_at} variant="chat" />
                  </p>
                </div>
              )
            })
          )}
        </div>
        {canMessage ? (
          <form onSubmit={send} className="border-t border-slate-100 p-3 sm:p-4">
            <div className="flex gap-2">
              <textarea
                rows={2}
                className="min-h-[2.5rem] flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm"
                placeholder="Написать педагогу…"
                value={draft}
                onChange={e => setDraft(e.target.value)}
                disabled={sending || loading}
              />
              <button
                type="submit"
                className="brand-button-primary h-10 shrink-0 self-end px-3"
                disabled={!draft.trim() || sending}
              >
                <Send size={16} />
              </button>
            </div>
          </form>
        ) : null}
      </div>
    </div>
  )
}
