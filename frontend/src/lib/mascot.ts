'use client'

export type MascotScenario = 'post_register_intro' | 'first_lesson_complete'

type StoredMascotScenario = MascotScenario | 'first_task_complete'

const MASCOT_QUEUE_KEY = 'codequest_mascot_queue'
export const MASCOT_QUEUE_EVENT = 'codequest:mascot-queue-updated'
const MASCOT_ONCE_PREFIX = 'codequest_mascot_once:'

function readQueue(): MascotScenario[] {
  if (typeof window === 'undefined') return []

  try {
    const raw = window.localStorage.getItem(MASCOT_QUEUE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as StoredMascotScenario[]
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item) => {
      if (item === 'post_register_intro' || item === 'first_lesson_complete') {
        return [item]
      }
      if (item === 'first_task_complete') {
        return ['first_lesson_complete']
      }
      return []
    })
  } catch {
    return []
  }
}

function writeQueue(queue: MascotScenario[]) {
  if (typeof window === 'undefined') return

  if (queue.length === 0) {
    window.localStorage.removeItem(MASCOT_QUEUE_KEY)
    return
  }

  window.localStorage.setItem(MASCOT_QUEUE_KEY, JSON.stringify(queue))
}

export function queueMascotScenario(scenario: MascotScenario) {
  const queue = readQueue()
  queue.push(scenario)
  writeQueue(queue)
  window.dispatchEvent(new CustomEvent(MASCOT_QUEUE_EVENT))
}

export function queueMascotScenarioOnce(scenario: MascotScenario, key: string) {
  if (typeof window === 'undefined') return false

  const storageKey = `${MASCOT_ONCE_PREFIX}${key}`
  if (window.localStorage.getItem(storageKey) === '1') {
    return false
  }

  window.localStorage.setItem(storageKey, '1')
  queueMascotScenario(scenario)
  return true
}

export function popMascotScenario(): MascotScenario | null {
  const queue = readQueue()
  const nextScenario = queue.shift() || null
  writeQueue(queue)
  return nextScenario
}
