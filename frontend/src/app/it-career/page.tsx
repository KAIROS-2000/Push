import type { Metadata } from 'next'

import { ItCareerPage } from '@/components/it-career-page'

export const metadata: Metadata = {
	title: 'Перспективы работы в IT | Progyx',
	description:
		'Вакансии, зарплаты и перспективы IT-профессий в 2026 году для учеников и родителей Progyx.',
}

export default function Page() {
	return <ItCareerPage />
}
