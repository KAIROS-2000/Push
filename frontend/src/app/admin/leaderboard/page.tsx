import { AdminAreaShell } from '@/components/admin-area-shell'
import { LeaderboardPageContent } from '@/components/leaderboard-page-content'

export default function AdminLeaderboardPage() {
	return (
		<AdminAreaShell area='admin' section='leaderboard'>
			<LeaderboardPageContent layout='admin' />
		</AdminAreaShell>
	)
}
