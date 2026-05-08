import { SupportRequestPage } from '@/components/support-request-page'
import { serverApi } from '@/lib/server-api'
import type { UserItem } from '@/types'

export default async function SupportPage() {
	const session = await serverApi<{ user: UserItem }>('/auth/me').catch(() => null)

	return (
		<main className='brand-app-shell'>
			<div className='page-shell mx-auto w-full max-w-[96rem]'>
				<SupportRequestPage initialUser={session?.user ?? null} />
			</div>
		</main>
	)
}
