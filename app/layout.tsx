import type { Metadata } from 'next'
import './globals.css'

const SITE_URL = process.env.NEXT_PUBLIC_SITE_URL || 'https://accessly.io'

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: 'Accessly — Accessibility & SEO audits, widget, and real-user monitoring',
    template: '%s · Accessly',
  },
  description:
    'Accessly makes any website accessible and search-ready: a 25+ tool accessibility widget, automated WCAG audits, technical-SEO audits, competitor benchmarking, and real-user monitoring — in one lightweight script.',
  keywords: [
    'web accessibility', 'WCAG audit', 'ADA compliance', 'accessibility widget',
    'technical SEO audit', 'core web vitals', 'real user monitoring', 'competitor analysis',
  ],
  applicationName: 'Accessly',
  authors: [{ name: 'Accessly' }],
  alternates: { canonical: '/' },
  openGraph: {
    type: 'website',
    url: SITE_URL,
    siteName: 'Accessly',
    title: 'Accessly — Accessibility & SEO audits, widget, and monitoring',
    description:
      'Make any website accessible and search-ready in minutes. Accessibility widget, WCAG + technical-SEO audits, competitor benchmarking, and real-user monitoring.',
  },
  twitter: {
    card: 'summary_large_image',
    title: 'Accessly — Accessibility & SEO in one platform',
    description: 'Accessibility widget, WCAG + technical-SEO audits, competitor benchmarking, and real-user monitoring.',
  },
  robots: { index: true, follow: true, googleBot: { index: true, follow: true, 'max-image-preview': 'large' } },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap"
          rel="stylesheet"
        />
      </head>
      <body className="min-h-full">{children}</body>
    </html>
  )
}
