import type { MetadataRoute } from "next";
import { SITE_URL } from "../lib/brand";
import { TIER1_TOOLS, COMING_SOON } from "../lib/pdf/tools";

// Every public route: catalog and one URL per tool engine.
// Soon-panel tools are included (real URLs, real content) at low priority;
// live tools get full weight.
export default function sitemap(): MetadataRoute.Sitemap {
  const tools = Object.keys(TIER1_TOOLS).map((slug) => ({
    url: `${SITE_URL}/free-tools/${slug}`,
    lastModified: new Date(),
    changeFrequency: "monthly" as const,
    priority: COMING_SOON.has(slug) ? 0.4 : 0.8,
  }));
  // Soon-panel routes have catalog cards but no engine spec yet. They are
  // real 200 URLs with content, so they belong in the sitemap too.
  const soonOnly = [...COMING_SOON]
    .filter((slug) => !(slug in TIER1_TOOLS))
    .map((slug) => ({
      url: `${SITE_URL}/free-tools/${slug}`,
      lastModified: new Date(),
      changeFrequency: "monthly" as const,
      priority: 0.4,
    }));
  return [
    {
      url: `${SITE_URL}/free-tools`,
      lastModified: new Date(),
      changeFrequency: "weekly",
      priority: 1,
    },
    ...tools,
    ...soonOnly,
  ];
}
