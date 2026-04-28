'use client'

import { useEffect, useRef, useState } from 'react'
import { api, getApiErrorMessage } from '@/lib/api'
import { setThemeWithTransition } from '@/lib/theme'
import { showErrorToast, showSuccessToast } from '@/lib/toast'
import { PUBLIC_API_URL } from '@/lib/public-env'
import { AppTheme, UserItem } from '@/types'

interface CosmeticItem {
  key: string
  name: string
  type: 'avatar' | 'frame' | 'theme'
  price: number
  file?: string
  preview?: [string, string]
  owned: boolean
}

interface Props {
  user: UserItem
  onClose: () => void
  onUserUpdate: (user: UserItem, newOwnedThemeKey?: string) => void
}

type Tab = 'avatar' | 'frame' | 'theme'

const TAB_LABELS: Record<Tab, string> = {
  avatar: 'Аватарки',
  frame: 'Рамки',
  theme: 'Темы',
}

function avatarUrl(file: string) {
  return `${PUBLIC_API_URL}/media/avatars/${encodeURIComponent(file)}`
}
function frameUrl(file: string) {
  return `${PUBLIC_API_URL}/media/frames/${encodeURIComponent(file)}`
}

export function CosmeticsShop({ user, onClose, onUserUpdate }: Props) {
  const [tab, setTab] = useState<Tab>('avatar')
  const [items, setItems] = useState<CosmeticItem[]>([])
  const [xp, setXp] = useState(user.xp)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<string | null>(null)
  const panelRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    api<{ items: CosmeticItem[]; xp: number }>('/cosmetics', undefined, true)
      .then((res) => {
        setItems(res.items)
        setXp(res.xp)
      })
      .catch(() => {})
      .finally(() => setLoading(false))
  }, [])

  // Close on backdrop click
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function handleBuy(item: CosmeticItem) {
    if (busy) return
    setBusy(item.key)
    try {
      const res = await api<{ message: string; xp: number }>(
        '/cosmetics/purchase',
        { method: 'POST', body: JSON.stringify({ item_key: item.key }) },
        true,
      )
      showSuccessToast(res.message)
      setXp(res.xp)
      setItems((prev) => prev.map((i) => (i.key === item.key ? { ...i, owned: true } : i)))
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось купить предмет.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleEquip(item: CosmeticItem) {
    if (busy) return
    setBusy(item.key + '_equip')
    try {
      const res = await api<{ user: UserItem }>(
        '/cosmetics/equip',
        { method: 'POST', body: JSON.stringify({ item_key: item.key, slot: item.type }) },
        true,
      )
      onUserUpdate(res.user, item.type === 'theme' ? item.key : undefined)
      if (item.type === 'theme') {
        await setThemeWithTransition(res.user.theme as AppTheme)
      }
      showSuccessToast('Надено!')
    } catch (e) {
      showErrorToast(getApiErrorMessage(e, 'Не удалось надеть предмет.'))
    } finally {
      setBusy(null)
    }
  }

  async function handleUnequip(slot: Tab) {
    if (busy) return
    setBusy('unequip_' + slot)
    try {
      const res = await api<{ user: UserItem }>(
        '/cosmetics/equip',
        { method: 'POST', body: JSON.stringify({ item_key: '', slot }) },
        true,
      )
      onUserUpdate(res.user)
      if (slot === 'theme') {
        await setThemeWithTransition(res.user.theme as AppTheme)
      }
    } catch {
      // ignore
    } finally {
      setBusy(null)
    }
  }

  const filtered = items.filter((i) => i.type === tab)

  const equippedKey =
    tab === 'avatar' ? user.avatar_id :
    tab === 'frame' ? user.frame_id :
    user.theme

  return (
    <div
      className="shop-backdrop"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div ref={panelRef} className="shop-panel" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="shop-header">
          <div>
            <h2 className="shop-title">Украшения профиля</h2>
            <p className="shop-xp-badge">
              <span className="shop-xp-icon">✦</span>
              {xp} XP
            </p>
          </div>
          <button className="shop-close" onClick={onClose} aria-label="Закрыть">✕</button>
        </div>

        {/* Tabs */}
        <div className="shop-tabs">
          {(Object.keys(TAB_LABELS) as Tab[]).map((t) => (
            <button
              key={t}
              className={`shop-tab ${tab === t ? 'shop-tab--active' : ''}`}
              onClick={() => setTab(t)}
            >
              {TAB_LABELS[t]}
            </button>
          ))}
        </div>

        {/* Unequip row */}
        {equippedKey && (
          <div className="shop-unequip-row">
            <span className="shop-unequip-label">Надет: <strong>{equippedKey}</strong></span>
            <button
              className="shop-unequip-btn"
              disabled={!!busy}
              onClick={() => void handleUnequip(tab)}
            >
              Снять
            </button>
          </div>
        )}

        {/* Grid */}
        {loading ? (
          <div className="shop-loading">Загружаем...</div>
        ) : (
          <div className={`shop-grid shop-grid--${tab}`}>
            {filtered.map((item) => {
              const isEquipped = equippedKey === item.key
              const isBusy = busy === item.key || busy === item.key + '_equip'
              return (
                <div
                  key={item.key}
                  className={`shop-card ${isEquipped ? 'shop-card--equipped' : ''} ${item.owned ? 'shop-card--owned' : ''}`}
                >
                  {/* Preview */}
                  <div className="shop-card__preview">
                    {item.type === 'avatar' && item.file && (
                      <img
                        src={avatarUrl(item.file)}
                        alt={item.name}
                        className="shop-avatar-img"
                        loading="lazy"
                      />
                    )}
                    {item.type === 'frame' && item.file && (
                      <div className="shop-frame-preview">
                        <div className="shop-frame-dummy" />
                        <img
                          src={frameUrl(item.file)}
                          alt={item.name}
                          className="shop-frame-img"
                          data-frame={item.key}
                          loading="lazy"
                        />
                      </div>
                    )}
                    {item.type === 'theme' && item.preview && (
                      <div
                        className="shop-theme-preview"
                        style={{ background: `linear-gradient(135deg, ${item.preview[0]} 0%, ${item.preview[1]} 100%)` }}
                      >
                        <span className="shop-theme-dot" style={{ background: item.preview[1] }} />
                      </div>
                    )}
                    {isEquipped && <div className="shop-equipped-badge">Надето</div>}
                  </div>

                  {/* Info */}
                  <div className="shop-card__info">
                    <p className="shop-card__name">{item.name}</p>
                    <p className="shop-card__price">
                      {item.price === 0 ? 'Бесплатно' : `${item.price} XP`}
                    </p>
                  </div>

                  {/* Actions */}
                  <div className="shop-card__actions">
                    {!item.owned && item.price > 0 ? (
                      <button
                        className="shop-btn shop-btn--buy"
                        disabled={isBusy || xp < item.price}
                        onClick={() => void handleBuy(item)}
                        title={xp < item.price ? `Нужно ${item.price} XP, есть ${xp}` : undefined}
                      >
                        {isBusy ? '...' : xp < item.price ? 'Мало XP' : 'Купить'}
                      </button>
                    ) : (
                      <button
                        className={`shop-btn ${isEquipped ? 'shop-btn--equipped' : 'shop-btn--equip'}`}
                        disabled={isBusy || isEquipped}
                        onClick={() => void handleEquip(item)}
                      >
                        {isBusy ? '...' : isEquipped ? 'Надето' : 'Надеть'}
                      </button>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
