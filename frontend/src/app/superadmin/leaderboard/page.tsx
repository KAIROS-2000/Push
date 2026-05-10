import { AdminAreaShell } from '@/components/admin-area-shell'
import { LeaderboardPageContent } from '@/components/leaderboard-page-content'

export default function SuperadminLeaderboardPage() {
	return (
		<AdminAreaShell area='superadmin' section='leaderboard'>
			<LeaderboardPageContent layout='admin' />
		</AdminAreaShell>
	)
}
