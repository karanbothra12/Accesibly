import type { Metadata } from 'next'
import { notFound } from 'next/navigation'
import LegalShell from '@/components/legal/LegalShell'
import { getPublishedPage } from '@/lib/pages'

// CMS pages are DB-driven; revalidate so SuperAdmin edits appear without a deploy.
export const revalidate = 120

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const { slug } = await params
  const page = await getPublishedPage(slug).catch(() => null)
  if (!page) return { title: 'Not found' }
  return {
    title: { absolute: page.seo_title || `${page.title} · Accessly` },
    description: page.seo_description || undefined,
    alternates: { canonical: `/p/${page.slug}` },
    openGraph: { title: page.seo_title || page.title, description: page.seo_description || undefined, url: `/p/${page.slug}` },
  }
}

export default async function ContentPageRoute({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params
  const page = await getPublishedPage(slug).catch(() => null)
  if (!page) notFound()

  return (
    <LegalShell title={page.title} updated={new Date(page.updated_at).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })}>
      {/* Body is authored by SuperAdmin (trusted) — rendered as HTML. */}
      <div dangerouslySetInnerHTML={{ __html: page.body }} />
    </LegalShell>
  )
}
