import { query, queryOne } from '@/lib/db'

// ── SuperAdmin-managed content pages (CMS) ───────────────────────
export type ContentPage = {
  id: number; slug: string; title: string
  seo_title: string | null; seo_description: string | null
  body: string; is_published: boolean; updated_at: string; created_at: string
}

// A published page for public rendering (null if missing/unpublished).
export async function getPublishedPage(slug: string): Promise<ContentPage | null> {
  return queryOne<ContentPage>(
    'SELECT * FROM content_pages WHERE slug = $1 AND is_published = TRUE',
    [slug]
  )
}

// Published slugs for the sitemap.
export async function listPublishedSlugs(): Promise<{ slug: string; updated_at: string }[]> {
  return query<{ slug: string; updated_at: string }>(
    'SELECT slug, updated_at FROM content_pages WHERE is_published = TRUE ORDER BY slug'
  )
}

// Normalize a user-entered slug to a safe URL segment.
export function normalizeSlug(input: string): string {
  return String(input).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 80)
}
