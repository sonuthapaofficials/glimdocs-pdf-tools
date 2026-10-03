import type { Metadata } from "next";
import { SITE_URL, SITE_NAME, OG_IMAGE } from "../../../lib/brand";
import { getToolSpec } from "../../../lib/pdf/tools";

// Server wrapper: [tool]/page.tsx is a client component, so per-tool
// metadata + structured data live here. Unknown slugs fall back to the
// catalog title (the page renders an honest "later tier" notice).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ tool: string }>;
}): Promise<Metadata> {
  const { tool } = await params;
  const spec = getToolSpec(tool);
  if (!spec) {
    return {
      title: `Free PDF Tool | ${SITE_NAME}`,
      description: `Free on-device PDF tools from ${SITE_NAME} — private by design, no signup.`,
      alternates: { canonical: "/free-tools" },
    };
  }
  // NOTE: title.template from the root layout does not apply to layout-level
  // metadata (verified in rendered HTML), so the brand suffix is explicit.
  const title = `${spec.title} — Free Online, No Signup | ${SITE_NAME}`;
  const description = `${spec.description} Free, private by design: files never leave your browser. No signup, no watermark.`;
  const url = `${SITE_URL}/free-tools/${spec.slug}`;
  return {
    title,
    description,
    alternates: { canonical: `/free-tools/${spec.slug}` },
    openGraph: {
      title,
      description,
      url,
      images: [{ url: OG_IMAGE, width: 2000, height: 2000, alt: `${SITE_NAME} logo` }],
    },
    twitter: {
      card: "summary",
      title,
      description,
      images: [OG_IMAGE],
    },
  };
}

export default function ToolLayout({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tool: string }>;
}) {
  return <ToolJsonLd params={params}>{children}</ToolJsonLd>;
}

async function ToolJsonLd({
  children,
  params,
}: {
  children: React.ReactNode;
  params: Promise<{ tool: string }>;
}) {
  const { tool } = await params;
  const spec = getToolSpec(tool);
  if (!spec) return <>{children}</>;
  const appJsonLd = {
    "@context": "https://schema.org",
    "@type": "WebApplication",
    name: `${spec.title} by ${SITE_NAME}`,
    url: `${SITE_URL}/free-tools/${spec.slug}`,
    description: spec.description,
    applicationCategory: "UtilitiesApplication",
    operatingSystem: "Web",
    browserRequirements: "Requires JavaScript",
    offers: { "@type": "Offer", price: "0", priceCurrency: "USD" },
  };
  const crumbJsonLd = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      { "@type": "ListItem", position: 1, name: "Home", item: SITE_URL },
      { "@type": "ListItem", position: 2, name: "Free PDF tools", item: `${SITE_URL}/free-tools` },
      {
        "@type": "ListItem",
        position: 3,
        name: spec.title,
        item: `${SITE_URL}/free-tools/${spec.slug}`,
      },
    ],
  };
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(appJsonLd) }} />
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(crumbJsonLd) }} />
      {children}
    </>
  );
}
