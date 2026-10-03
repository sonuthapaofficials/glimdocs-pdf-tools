import type { Metadata, Viewport } from "next";
import Link from "next/link";
import { SITE_URL, SITE_NAME, OG_IMAGE } from "../lib/brand";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: `50+ Free PDF Tools — Private, On-Device, No Signup | ${SITE_NAME}`,
    template: `%s | ${SITE_NAME}`,
  },
  description:
    "Merge, split, compress, convert, sign, and edit PDFs entirely in your browser. Free, private by design, no signup.",
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    images: [{ url: OG_IMAGE, width: 2000, height: 2000, alt: `${SITE_NAME} logo` }],
  },
  icons: {
    icon: [
      { url: "/glogo.svg", type: "image/svg+xml" },
      { url: "/glogo.ico", sizes: "any" },
      { url: "/favicon.ico", sizes: "any" },
    ],
  },
  robots: { index: true, follow: true },
};

export const viewport: Viewport = {
  themeColor: "#ffffff",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-background text-on-background font-body">
        <header className="fixed top-0 w-full z-50 bg-surface-container-lowest/90 backdrop-blur-md border-b border-outline-variant/30">
          <div className="h-20 max-w-7xl mx-auto px-4 sm:px-6 lg:px-12 flex items-center justify-between gap-4">
            <Link href="/free-tools" className="flex items-center gap-3 shrink-0" aria-label={`${SITE_NAME} free tools home`}>
              <img src="/glogo.svg" alt={`${SITE_NAME} logo`} className="h-8 w-auto object-contain shrink-0" />
              <span className="text-base font-bold tracking-tight text-on-surface leading-none">
                {SITE_NAME} <span className="font-medium text-on-surface-variant">· Free PDF Tools</span>
              </span>
            </Link>
            <a
              href="https://github.com/sonuthapaofficials/glimdocs-pdf-tools"
              target="_blank"
              rel="noreferrer"
              className="px-4 py-2 text-sm font-semibold rounded-lg bg-primary/90 text-on-primary hover:bg-primary transition-all"
            >
              Source (AGPL)
            </a>
          </div>
        </header>
        <div className="pt-20 flex-1 flex flex-col">{children}</div>
      </body>
    </html>
  );
}
