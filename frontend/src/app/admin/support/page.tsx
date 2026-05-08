import { AdminSupportPageView } from '@/components/admin-support-page-view'
import { serverApi } from '@/lib/server-api'
import type { UserItem } from '@/types'
import { redirect } from 'next/navigation'

export default async function AdminSupportPage() {
	const session = await serverApi<{ user: UserItem }>('/auth/me').catch(() => null)
	if (!session?.user) {
		redirect('/auth/login')
	}
	if (session.user.role !== 'admin' && session.user.role !== 'superadmin') {
		redirect('/dashboard')
	}

	return <AdminSupportPageView area='admin' currentUserId={session.user.id} />
}
