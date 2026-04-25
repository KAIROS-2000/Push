'use client'

import { useEffect, useState } from 'react'

interface UserAvatarProps {
  name: string
  url?: string | null
  /** Tailwind classes for size, border, shadow etc. Must include h-* and w-*. */
  className?: string
}

export function UserAvatar({ name, url, className = '' }: UserAvatarProps) {
  const [imgError, setImgError] = useState(false)

  useEffect(() => {
    setImgError(false)
  }, [url])

  const initials =
    name
      .trim()
      .split(/\s+/)
      .map(w => w[0] ?? '')
      .join('')
      .slice(0, 2)
      .toUpperCase() || '?'

  return (
    <div
      className={`shrink-0 rounded-full overflow-hidden bg-slate-100 border-2 border-slate-200 flex items-center justify-center font-bold text-slate-600 select-none ${className}`}
    >
      {url && !imgError ? (
        <img
          src={url}
          alt={name}
          style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
          onError={() => setImgError(true)}
        />
      ) : (
        initials
      )}
    </div>
  )
}
