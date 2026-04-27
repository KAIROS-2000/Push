import { MessagesPageView } from '@/components/messages-page-view'
import { serverApi } from '@/lib/server-api'
import { MessagingSummaryResponse, UserItem } from '@/types'
import { redirect } from 'next/navigation'

export default async function MessagesPage() {
	const session = await serverApi<{ user: UserItem }>('/auth/me').catch(() => null)

	if (!session?.user) {
		redirect('/auth/login')
	}

	if (
		session.user.role !== 'student' &&
		session.user.role !== 'teacher' &&
		session.user.role !== 'parent'
	) {
		redirect('/dashboard')
	}

	const initialSummary = await serverApi<MessagingSummaryResponse>(
		'/messaging/summary',
	).catch(() => null)

	return (
		<main className='brand-app-shell'>
			<div className='page-shell mx-auto w-full max-w-[96rem]'>
				<MessagesPageView
					user={session.user}
					initialSummary={initialSummary}
				/>
			</div>
		</main>
	)
}
