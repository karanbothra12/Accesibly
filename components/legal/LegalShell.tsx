import Link from 'next/link'

// Shared shell for legal pages (Terms, Privacy). Clean, readable prose.
export default function LegalShell({
  title, updated, children,
}: {
  title: string
  updated?: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-white text-slate-900">
      <header className="sticky top-0 z-40 bg-white/80 backdrop-blur-md border-b border-slate-100">
        <div className="max-w-3xl mx-auto px-6 h-16 flex items-center justify-between">
          <Link href="/" className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-primary to-violet flex items-center justify-center text-white font-bold shadow-sm">A</div>
            <span className="font-bold tracking-tight">Accessly</span>
          </Link>
          <Link href="/" className="text-sm text-slate-500 hover:text-slate-900">← Back to home</Link>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-12">
        <h1 className="text-3xl lg:text-4xl font-bold tracking-tight">{title}</h1>
        {updated && <p className="mt-2 text-sm text-slate-500">Last updated: {updated}</p>}

        <article className="legal-prose mt-8 space-y-5 text-[15px] leading-relaxed text-slate-700
          [&_h2]:text-xl [&_h2]:font-bold [&_h2]:text-slate-900 [&_h2]:pt-3
          [&_p]:leading-relaxed [&_ul]:list-disc [&_ul]:pl-6 [&_ul]:space-y-1.5
          [&_a]:text-primary [&_a:hover]:underline">
          {children}
        </article>

        <div className="mt-12 pt-6 border-t border-slate-100 flex flex-wrap gap-4 text-sm text-slate-500">
          <Link href="/terms" className="hover:text-slate-900">Terms of Service</Link>
          <Link href="/privacy" className="hover:text-slate-900">Privacy Policy</Link>
          <Link href="/" className="hover:text-slate-900">Home</Link>
        </div>
      </main>
    </div>
  )
}

// Small heading helper for consistent section styling.
export function H2({ children }: { children: React.ReactNode }) {
  return <h2 className="text-xl font-bold text-slate-900 pt-2">{children}</h2>
}
