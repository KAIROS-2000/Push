'use client'

import { SiteHeader } from '@/components/site-header'
import { usePathname } from 'next/navigation'

function shouldRenderHeader(pathname: string | null) {
  return !pathname?.startsWith('/auth')
}

export function SiteChrome() {
  const pathname = usePathname()

  if (!shouldRenderHeader(pathname)) {
    return null
  }

  return <SiteHeader />
}
