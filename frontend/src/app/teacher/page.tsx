import { TeacherWorkspace } from '@/components/teacher-workspace'
import { serverApi } from '@/lib/server-api'
import { TeacherOverviewData } from '@/types'

export default async function TeacherPage() {
	const initialOverview = await serverApi<TeacherOverviewData>(
		'/teacher/overview',
	).catch(() => null)

	return (
		<main className='teacher-page'>
			<div className='teacher-page__shell page-shell mx-auto w-full max-w-[96rem] space-y-6'>
				<TeacherWorkspace initialOverview={initialOverview} />
			</div>
		</main>
	)
}
