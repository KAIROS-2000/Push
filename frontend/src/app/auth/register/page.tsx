'use client'

import { useEffect, useState } from 'react'
import { AuthForm } from '@/components/auth-form'
import { api, getApiErrorMessage } from '@/lib/api'
import { showErrorToast } from '@/lib/toast'
import { AuthOptions } from '@/types'

const DEFAULT_REGISTER_OPTIONS: AuthOptions = {
  roles: ['student', 'teacher'],
  age_groups: ['junior', 'middle', 'senior'],
}

export default function RegisterPage() {
  const [options, setOptions] = useState<AuthOptions | undefined>()

  useEffect(() => {
    api<AuthOptions>('/auth/options')
      .then(setOptions)
      .catch((e) => {
        setOptions(DEFAULT_REGISTER_OPTIONS)
        showErrorToast(
          getApiErrorMessage(
            e,
            'Не удалось загрузить настройки регистрации. Используются значения по умолчанию.',
          ),
        )
      })
  }, [])

  return <AuthForm mode="register" options={options} />
}
