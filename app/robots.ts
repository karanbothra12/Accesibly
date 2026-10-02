import type { MetadataRoute } from 'next'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://accessly.io'

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      // Public marketing pages are crawlable; the app + API are not.
      { userAgent: '*', allow: '/', disallow: ['/dashboard', '/admin', '/api', '/settings'] },
    ],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  }
}
