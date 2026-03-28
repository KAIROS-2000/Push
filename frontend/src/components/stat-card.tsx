export function StatCard({ value, label, accent }: { value: string; label: string; accent?: string }) {
  return (
    <article className="codequest-card p-5">
      <p className={`text-3xl font-black ${accent || 'text-slate-900'}`}>{value}</p>
      <p className="mt-2 text-sm text-slate-500">{label}</p>
    </article>
  )
}
