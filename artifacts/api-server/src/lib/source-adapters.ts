export const sourceConnectors = [
  {
    id: "demo-government",
    name: "Government Reporting",
    description: "Demonstration adapter for official releases and public government reporting.",
    status: "READY",
    sourceTypes: ["GOVERNMENT"],
  },
  {
    id: "demo-open-web",
    name: "Open Web Search",
    description: "Demonstration adapter. Configure an approved web-search provider for live retrieval.",
    status: "NEEDS_CONFIGURATION",
    sourceTypes: ["NEWS", "WEB"],
  },
  {
    id: "demo-academic",
    name: "Academic Research",
    description: "Demonstration adapter for journals, research institutes, and technical publications.",
    status: "READY",
    sourceTypes: ["ACADEMIC"],
  },
] as const;

const templates = [
  {
    title: "Official update identifies a shift in operating conditions",
    source: "Government Reporting Demo",
    sourceType: "GOVERNMENT" as const,
    relevance: 0.94,
    reliability: "HIGH" as const,
    bluf: "Official reporting indicates a measurable change in the operating environment, but the release does not establish intent or long-term trajectory.",
    keyPoints: [
      "The reported change is corroborated by two observable indicators.",
      "The source has direct access but may emphasize policy-consistent framing.",
      "Follow-on reporting is required to determine whether the shift is temporary.",
    ],
    tags: ["official reporting", "indicators", "intent gap"],
  },
  {
    title: "Independent reporting highlights second-order implications",
    source: "Open Web Demo",
    sourceType: "NEWS" as const,
    relevance: 0.87,
    reliability: "MODERATE" as const,
    bluf: "Independent reporting broadly aligns with the official account while identifying economic and regional effects not addressed in the primary release.",
    keyPoints: [
      "Key factual claims align with public primary-source material.",
      "Several impact claims rely on unnamed sources.",
      "The report offers useful regional context but limited technical detail.",
    ],
    tags: ["corroboration", "regional effects", "unnamed sources"],
  },
  {
    title: "Research review provides historical baseline and alternatives",
    source: "Academic Research Demo",
    sourceType: "ACADEMIC" as const,
    relevance: 0.82,
    reliability: "HIGH" as const,
    bluf: "Historical comparison suggests the observed pattern has multiple plausible explanations and should not be treated as a single-indicator warning.",
    keyPoints: [
      "The study defines a useful historical baseline.",
      "Methodology and assumptions are transparent.",
      "The dataset predates the latest reporting period.",
    ],
    tags: ["baseline", "alternative hypotheses", "methodology"],
  },
  {
    title: "Specialist commentary reports conflicting early indicators",
    source: "Open Web Demo",
    sourceType: "WEB" as const,
    relevance: 0.71,
    reliability: "LOW" as const,
    bluf: "Specialist commentary identifies a possible conflicting indicator, but source access and collection methodology are unclear.",
    keyPoints: [
      "The claim is relevant but currently uncorroborated.",
      "Source identity and access are not disclosed.",
      "The indicator should be retained as a collection requirement, not a judgment driver.",
    ],
    tags: ["conflicting indicator", "low confidence", "collection gap"],
  },
] as const;

export function generateDemonstrationFiles(prompt: string, maxResults = 8) {
  const promptTag = prompt
    .split(/\s+/)
    .filter((word) => word.length > 5)
    .slice(0, 2)
    .join(" ")
    .toLowerCase();

  return templates.slice(0, Math.min(maxResults, templates.length)).map((item, index) => ({
    id: crypto.randomUUID(),
    ...item,
    publishedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    keyPoints: [...item.keyPoints],
    tags: promptTag ? [...item.tags, promptTag] : [...item.tags],
    url: `about:blank#demonstration-source-${index + 1}`,
  }));
}
