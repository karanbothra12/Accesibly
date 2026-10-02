import type { MetadataRoute } from 'next'
import { listPublishedSlugs } from '@/lib/pages'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://accessly.io'

export const revalidate = 3600

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const now = new Date()
  const base: MetadataRoute.Sitemap = [
    { url: `${SITE_URL}/`, lastModified: now, changeFrequency: 'weekly', priority: 1 },
    { url: `${SITE_URL}/login`, lastModified: now, changeFrequency: 'monthly', priority: 0.3 },
    { url: `${SITE_URL}/register`, lastModified: now, changeFrequency: 'monthly', priority: 0.6 },
  ]
  // Published CMS pages (Terms, Privacy, and any others created in the panel).
  const pages = await listPublishedSlugs().catch(() => [])
  for (const pg of pages) {
    base.push({ url: `${SITE_URL}/p/${pg.slug}`, lastModified: new Date(pg.updated_at), changeFrequency: 'yearly', priority: 0.2 })
  }
  return base
}
