import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, OG_IMAGE } from "../../lib/brand";
import { TIER1_TOOLS } from "../../lib/pdf/tools";

// Server wrapper: free-tools/page.tsx is a client component, so catalog
// metadata + structured data live here.
export const metadata: Metadata = {
  title: "50+ Free PDF Tools — Private, On-Device, No Signup",
  description:
    "Merge, split, compress, convert, sign, deskew, and edit PDFs entirely in your browser. 50+ free tools — your files never leave your device.",
  alternates: { canonical: "/free-tools" },
  openGraph: {
    title: `50+ Free PDF Tools | ${SITE_NAME}`,
    description:
      "Merge, split, compress, convert, sign, and edit PDFs entirely in your browser. Free, private by design, no signup.",
    url: `${SITE_URL}/free-tools`,
    images: [{ url: OG_IMAGE, width: 2000, height: 2000, alt: `${SITE_NAME} logo` }],
  },
};

const catalogJsonLd = {
  "@context": "https://schema.org",
  "@type": "ItemList",
  name: `${SITE_NAME} free PDF tools`,
  itemListElement: Object.values(TIER1_TOOLS).map((t, i) => ({
    "@type": "ListItem",
    position: i + 1,
    url: `${SITE_URL}/free-tools/${t.slug}`,
    name: t.title,
    description: t.description,
  })),
};

export default function FreeToolsLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(catalogJsonLd) }} />
      {children}
    </>
  );
}
