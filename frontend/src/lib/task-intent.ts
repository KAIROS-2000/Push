const ACTION_TOKENS = [
  'напиши',
  'написать',
  'создай',
  'создать',
  'реализуй',
  'реализовать',
  'сделай',
  'сделать',
  'добавь',
  'добавить',
  'используй',
  'использовать',
  'объяви',
  'объявить',
  'выведи',
  'вывести',
  'проверь',
  'проверить',
  'write',
  'create',
  'implement',
  'declare',
  'print',
  'use',
  'check',
]

const MARKER_TOKENS = [
  'if',
  'else',
  'let',
  'const',
  'function',
  'stdin',
  'stdout',
  'javascript',
  'python',
]

const MARKER_SNIPPETS = [
  'console.log',
  'input(',
  'print(',
  'addeventlistener',
  '=>',
]

function escapeRegex(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

function hasToken(text: string, token: string) {
  const pattern = new RegExp(`(^|[^a-zA-Zа-яА-ЯёЁ0-9_])${escapeRegex(token)}($|[^a-zA-Zа-яА-ЯёЁ0-9_])`, 'i')
  return pattern.test(text)
}

function normalizeKeywords(value: string[] | string | null | undefined) {
  if (Array.isArray(value)) return value.map((item) => String(item || '').trim()).filter(Boolean)
  if (!value) return []
  return String(value)
    .replace(/\n/g, ',')
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
}

interface CodeIntentInput {
  title?: string | null
  prompt?: string | null
  keywords?: string[] | string | null
  starterCode?: string | null
}

export function hasExplicitCodeTaskIntent({
  title,
  prompt,
  keywords,
  starterCode,
}: CodeIntentInput) {
  if ((starterCode || '').trim()) {
    return true
  }

  const fragments = [title, prompt, ...normalizeKeywords(keywords)]
    .map((item) => String(item || '').trim())
    .filter(Boolean)

  if (fragments.length === 0) {
    return false
  }

  const normalized = fragments.join(' ').toLowerCase()
  const hasAction = ACTION_TOKENS.some((token) => hasToken(normalized, token))
  const hasMarker = MARKER_SNIPPETS.some((snippet) => normalized.includes(snippet)) || MARKER_TOKENS.some((token) => hasToken(normalized, token))
  return hasAction && hasMarker
}
