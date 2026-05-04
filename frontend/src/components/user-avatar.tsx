'use client'

import { AVATAR_FILES, FRAME_FILES } from '@/lib/cosmetics-catalog'
import { PUBLIC_API_URL } from '@/lib/public-env'

interface Props {
  avatarId: string | null | undefined
  frameId?: string | null | undefined
  size?: number
  className?: string
}

const OVERLAY_FRAME_IDS = new Set([
  '\u0431\u0430\u043d\u0442\u0438\u043a',
  '\u043e\u0447\u043a\u0438',
  '\u043a\u043e\u0440\u043e\u043d\u0430',
])

export function UserAvatar({ avatarId, frameId, size = 64, className = '' }: Props) {
  const avatarFile = avatarId ? AVATAR_FILES[avatarId] : null
  const frameFile = frameId ? FRAME_FILES[frameId] : null
  const frameStyle = frameFile ? (OVERLAY_FRAME_IDS.has(frameId ?? '') ? 'overlay' : 'ring') : 'none'

  return (
    <div
      className={`user-avatar-wrap ${className}`}
      data-frame={frameId ?? undefined}
      data-has-frame={frameFile ? 'true' : 'false'}
      data-frame-style={frameStyle}
      style={{ width: size, height: size }}
    >
      <div className="user-avatar-base">
        {avatarFile ? (
          <img
            src={`${PUBLIC_API_URL}/media/avatars/${encodeURIComponent(avatarFile)}`}
            alt="Аватар"
            className="user-avatar-img"
            width={size}
            height={size}
          />
        ) : (
          <div className="user-avatar-placeholder">
            <svg viewBox="0 0 24 24" fill="currentColor" width={size * 0.55} height={size * 0.55}>
              <path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/>
            </svg>
          </div>
        )}
      </div>
      {frameFile && (
        <img
          src={`${PUBLIC_API_URL}/media/frames/${encodeURIComponent(frameFile)}`}
          alt=""
          aria-hidden="true"
          className="user-avatar-frame"
          data-frame={frameId}
          width={size}
          height={size}
        />
      )}
    </div>
  )
}
