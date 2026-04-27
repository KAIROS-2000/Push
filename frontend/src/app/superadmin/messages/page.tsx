import { AdminMessagesPageView } from '@/components/admin-messages-page-view'
import { serverApi } from '@/lib/server-api'
import type { StaffMessagingSummaryResponse, UserItem } from '@/types'
import { redirect } from 'next/navigation'

export default async function SuperadminMessagesPage() {
	const session = await serverApi<{ user: UserItem }>('/auth/me').catch(() => null)
	if (!session?.user) {
		redirect('/auth/login')
	}
	if (session.user.role !== 'superadmin') {
		redirect('/dashboard')
	}

	const initial = await serverApi<StaffMessagingSummaryResponse>('/staff-messaging/summary').catch(() => null)

	return (
		<AdminMessagesPageView area='superadmin' currentUserId={session.user.id} initial={initial} />
	)
}
