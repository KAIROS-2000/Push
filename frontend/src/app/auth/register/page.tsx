'use client'

import { useEffect, useState } from 'react'
import { AuthForm } from '@/components/auth-form'
import { api } from '@/lib/api'
import { AuthOptions } from '@/types'

export default function RegisterPage() {
  const [options, setOptions] = useState<AuthOptions | undefined>()

  useEffect(() => {
    api<AuthOptions>('/auth/options').then(setOptions).catch(() => undefined)
  }, [])

  return <AuthForm mode="register" options={options} />
}
