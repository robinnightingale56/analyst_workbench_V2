export type SourceFile = {
  id: string;
  title: string;
  source: string;
  sourceType: "NEWS" | "GOVERNMENT" | "ACADEMIC" | "SOCIAL" | "WEB" | "INTERNAL";
  publishedAt: string;
  relevance: number;
  reliability: "HIGH" | "MODERATE" | "LOW" | "UNKNOWN";
  bluf: string;
  keyPoints: string[];
  tags: string[];
  url: string;
  retrievedAt: string;
  collectionMethod: string;
  content: string;
  contentDepth: "FULL_TEXT" | "EXCERPT" | "METADATA";
};

export const sourceConnectors = [
  {
    id: "google-news-rss",
    name: "Google News",
    description: "Live news and article discovery through the public Google News RSS feed.",
    status: "READY",
    mode: "LIVE",
    sourceTypes: ["NEWS", "WEB"],
  },
  {
    id: "bing-news-rss",
    name: "Bing News",
    description: "Live news discovery with substantive report snippets from Bing's public RSS feed.",
    status: "READY",
    mode: "LIVE",
    sourceTypes: ["NEWS", "WEB"],
  },
  {
    id: "federal-register",
    name: "Federal Register",
    description: "Live U.S. rules, notices, presidential documents, and official publications.",
    status: "READY",
    mode: "LIVE",
    sourceTypes: ["GOVERNMENT"],
  },
  {
    id: "crossref",
    name: "Crossref Research",
    description: "Live scholarly publication metadata from the public Crossref API.",
    status: "READY",
    mode: "LIVE",
    sourceTypes: ["ACADEMIC"],
  },
  {
    id: "demonstration-library",
    name: "Demonstration Library",
    description: "Synthetic records for training and interface demonstrations only.",
    status: "READY",
    mode: "DEMONSTRATION",
    sourceTypes: ["GOVERNMENT", "NEWS", "ACADEMIC", "WEB"],
  },
] as const;

export function isKnownSourceConnector(id: string) {
  return sourceConnectors.some((connector) => connector.id === id);
}

type AdapterResult = {
  files: SourceFile[];
  notices: string[];
};

function cleanText(value: string | undefined, fallback: string) {
  const text = (value ?? "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 700);
}

function cleanContent(value: string | undefined, fallback: string) {
  const text = (value ?? "")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]*>/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return (text || fallback).slice(0, 8_000);
}

function promptTags(prompt: string) {
  return prompt
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 4)
    .slice(0, 4);
}

async function fetchJson<T>(url: URL): Promise<T> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AnalystWorkbenchProofOfConcept/0.1",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`provider returned ${response.status}`);
  }
  const contentType = response.headers.get("content-type") ?? "";
  if (!contentType.includes("json")) {
    throw new Error("provider returned an unexpected content type");
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 5_000_000) {
    throw new Error("provider response exceeded the 5 MB limit");
  }
  const text = await response.text();
  if (text.length > 5_000_000) {
    throw new Error("provider response exceeded the 5 MB limit");
  }
  return JSON.parse(text) as T;
}

async function fetchText(url: URL): Promise<string> {
  const response = await fetch(url, {
    headers: {
      Accept: "application/rss+xml, application/xml, text/xml",
      "User-Agent": "AnalystWorkbenchProofOfConcept/0.1",
    },
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`provider returned ${response.status}`);
  }
  const contentLength = Number(response.headers.get("content-length") ?? "0");
  if (contentLength > 5_000_000) {
    throw new Error("provider response exceeded the 5 MB limit");
  }
  const text = await response.text();
  if (text.length > 5_000_000) {
    throw new Error("provider response exceeded the 5 MB limit");
  }
  return text;
}

function rssValue(item: string, tag: string) {
  const match = item.match(new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${tag}>`, "i"));
  return cleanText(match?.[1]?.replace(/<!\[CDATA\[|\]\]>/g, ""), "");
}

async function searchGoogleNews(prompt: string, limit: number): Promise<SourceFile[]> {
  const url = new URL("https://news.google.com/rss/search");
  url.searchParams.set("q", prompt);
  url.searchParams.set("hl", "en-US");
  url.searchParams.set("gl", "US");
  url.searchParams.set("ceid", "US:en");
  const xml = await fetchText(url);
  const retrievedAt = new Date().toISOString();
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, Math.min(limit, 25))
    .map((match) => match[1] ?? "");
  return items.map((item, index) => {
    const rawTitle = rssValue(item, "title") || "Untitled news report";
    const source = rssValue(item, "source") || rawTitle.split(" - ").at(-1) || "News source";
    const title = rawTitle.endsWith(` - ${source}`)
      ? rawTitle.slice(0, -(` - ${source}`.length))
      : rawTitle;
    const publishedAt = rssValue(item, "pubDate");
    const feedContent = rssValue(item, "description");
    const articleUrl = rssValue(item, "link") || "https://news.google.com/";
    return {
      id: crypto.randomUUID(),
      title,
      source,
      sourceType: "NEWS",
      publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt))
        ? new Date(publishedAt).toISOString()
        : retrievedAt,
      relevance: Math.max(0.55, 0.95 - index * 0.035),
      reliability: "UNKNOWN",
      bluf: `${title}. This is a live discovery result; source credibility and the full article must be reviewed before use.`,
      keyPoints: [
        `Published by ${source} and discovered through Google News.`,
        "The feed supplies article metadata rather than a validated intelligence judgment.",
        "Review the linked article for sourcing, context, and possible bias.",
      ],
      tags: [...promptTags(prompt), "live", "news"],
      url: articleUrl,
      retrievedAt,
      collectionMethod: "Google News public RSS",
      content: cleanContent(
        feedContent,
        `${title}. The RSS provider did not include an article excerpt; use the linked report for full context.`,
      ),
      contentDepth: "METADATA",
    } satisfies SourceFile;
  });
}

export function parseBingNewsRss(
  xml: string,
  prompt: string,
  limit: number,
  retrievedAt = new Date().toISOString(),
): SourceFile[] {
  const items = [...xml.matchAll(/<item>([\s\S]*?)<\/item>/gi)]
    .slice(0, Math.min(limit, 25))
    .map((match) => match[1] ?? "");
  return items.map((item, index) => {
    const title = rssValue(item, "title") || "Untitled news report";
    const source = rssValue(item, "News:Source") || "Bing News source";
    const publishedAt = rssValue(item, "pubDate");
    const description = cleanContent(rssValue(item, "description"), "");
    const substantiveExcerpt =
      description.length >= 80 && description.toLowerCase() !== title.toLowerCase();
    return {
      id: crypto.randomUUID(),
      title,
      source,
      sourceType: "NEWS",
      publishedAt: publishedAt && !Number.isNaN(Date.parse(publishedAt))
        ? new Date(publishedAt).toISOString()
        : retrievedAt,
      relevance: Math.max(0.55, 0.95 - index * 0.035),
      reliability: "UNKNOWN",
      bluf: substantiveExcerpt
        ? description.slice(0, 700)
        : `${title}. The feed did not include a substantive report excerpt.`,
      keyPoints: [
        `Published by ${source} and discovered through Bing News.`,
        substantiveExcerpt
          ? "The public feed supplied a substantive report snippet used for candidate extraction."
          : "The public feed supplied discovery metadata only; it cannot support a factual count.",
        "Review the linked report before final dissemination.",
      ],
      tags: [...promptTags(prompt), "live", "news"],
      url: rssValue(item, "link") || "https://www.bing.com/news",
      retrievedAt,
      collectionMethod: "Bing News public RSS",
      content: substantiveExcerpt ? description : title,
      contentDepth: substantiveExcerpt ? "EXCERPT" : "METADATA",
    };
  });
}

async function searchBingNews(prompt: string, limit: number): Promise<SourceFile[]> {
  const url = new URL("https://www.bing.com/news/search");
  url.searchParams.set("q", prompt);
  url.searchParams.set("format", "rss");
  const xml = await fetchText(url);
  return parseBingNewsRss(xml, prompt, limit);
}

async function searchFederalRegister(prompt: string, limit: number): Promise<SourceFile[]> {
  const url = new URL("https://www.federalregister.gov/api/v1/documents.json");
  url.searchParams.set("per_page", String(Math.min(limit, 20)));
  url.searchParams.set("order", "relevance");
  url.searchParams.set("conditions[term]", prompt);
  const payload = await fetchJson<{
    results?: Array<{
      title?: string;
      abstract?: string;
      html_url?: string;
      publication_date?: string;
      type?: string;
      agencies?: Array<{ name?: string }>;
    }>;
  }>(url);
  const retrievedAt = new Date().toISOString();
  return (payload.results ?? []).map((document, index) => {
    const title = cleanText(document.title, "Untitled Federal Register document");
    const agencyNames = (document.agencies ?? [])
      .map((agency) => agency.name)
      .filter(Boolean)
      .join(", ");
    return {
      id: crypto.randomUUID(),
      title,
      source: agencyNames || "Federal Register",
      sourceType: "GOVERNMENT",
      publishedAt: document.publication_date
        ? new Date(`${document.publication_date}T12:00:00Z`).toISOString()
        : retrievedAt,
      relevance: Math.max(0.58, 0.96 - index * 0.04),
      reliability: "HIGH",
      bluf: cleanText(
        document.abstract,
        `${title}. Review the official document for scope, authorities, dates, and implications.`,
      ),
      keyPoints: [
        `Document type: ${document.type || "official publication"}.`,
        `Publishing organization: ${agencyNames || "not provided"}.`,
        "Primary-source authority is high; analytic relevance still requires review.",
      ],
      tags: [...promptTags(prompt), "live", "official"],
      url: document.html_url || "https://www.federalregister.gov/",
      retrievedAt,
      collectionMethod: "Federal Register public API",
      content: cleanText(
        document.abstract,
        `${title}. The public API did not include an abstract; review the official document.`,
      ),
      contentDepth: document.abstract ? "EXCERPT" : "METADATA",
    } satisfies SourceFile;
  });
}

async function searchCrossref(prompt: string, limit: number): Promise<SourceFile[]> {
  const url = new URL("https://api.crossref.org/works");
  url.searchParams.set("query", prompt);
  url.searchParams.set("rows", String(Math.min(limit, 20)));
  url.searchParams.set("sort", "relevance");
  const payload = await fetchJson<{
    message?: {
      items?: Array<{
        title?: string[];
        abstract?: string;
        URL?: string;
        publisher?: string;
        type?: string;
        DOI?: string;
        issued?: { "date-parts"?: number[][] };
      }>;
    };
  }>(url);
  const retrievedAt = new Date().toISOString();
  return (payload.message?.items ?? []).map((work, index) => {
    const title = cleanText(work.title?.[0], "Untitled research publication");
    const dateParts = work.issued?.["date-parts"]?.[0] ?? [];
    const year = dateParts[0] ?? new Date().getUTCFullYear();
    const month = Math.max(1, Math.min(12, dateParts[1] ?? 1));
    const day = Math.max(1, Math.min(28, dateParts[2] ?? 1));
    return {
      id: crypto.randomUUID(),
      title,
      source: work.publisher || "Crossref indexed publisher",
      sourceType: "ACADEMIC",
      publishedAt: new Date(Date.UTC(year, month - 1, day, 12)).toISOString(),
      relevance: Math.max(0.55, 0.94 - index * 0.035),
      reliability: "MODERATE",
      bluf: cleanText(
        work.abstract,
        `${title}. Crossref provides publication metadata; methodology and findings require review at the linked source.`,
      ),
      keyPoints: [
        `Publication type: ${work.type || "not provided"}.`,
        `Publisher: ${work.publisher || "not provided"}.`,
        `DOI: ${work.DOI || "not provided"}.`,
      ],
      tags: [...promptTags(prompt), "live", "research"],
      url: work.URL || "https://www.crossref.org/",
      retrievedAt,
      collectionMethod: "Crossref public REST API",
      content: cleanText(
        work.abstract,
        `${title}. Crossref did not include an abstract; review the linked publication.`,
      ),
      contentDepth: work.abstract ? "EXCERPT" : "METADATA",
    } satisfies SourceFile;
  });
}

const templates = [
  {
    title: "Training record: official update identifies a change",
    source: "Demonstration Library",
    sourceType: "GOVERNMENT" as const,
    reliability: "HIGH" as const,
    bluf: "Synthetic training reporting indicates a measurable change, but does not establish intent or long-term trajectory.",
    content: "On 12 September 2026, Country Alpha and Country Beta exchanged fire near the North Ridge border crossing. Officials described the encounter as brief and reported no territorial change.",
  },
  {
    title: "Training record: independent reporting adds context",
    source: "Demonstration Library",
    sourceType: "NEWS" as const,
    reliability: "MODERATE" as const,
    bluf: "Synthetic independent reporting broadly aligns with the training scenario while adding second-order implications.",
    content: "Independent reporting said Country Alpha and Country Beta clashed at the North Ridge border crossing on 12 September 2026. The exchange appears to describe the same brief incident reported by officials.",
  },
] as const;

export function generateDemonstrationFiles(prompt: string, maxResults = 4): SourceFile[] {
  const retrievedAt = new Date().toISOString();
  return templates.slice(0, Math.min(maxResults, templates.length)).map((item, index) => ({
    id: crypto.randomUUID(),
    ...item,
    publishedAt: new Date(Date.now() - index * 86_400_000).toISOString(),
    relevance: 0.82 - index * 0.08,
    keyPoints: [
      "This record is synthetic and must not be cited as live reporting.",
      "Use it only to exercise selection and assessment workflows.",
    ],
    tags: [...promptTags(prompt), "demonstration"],
    url: `about:blank#demonstration-source-${index + 1}`,
    retrievedAt,
    collectionMethod: "Synthetic demonstration library",
    contentDepth: "FULL_TEXT",
  }));
}

export async function runOpenSourceResearch(
  prompt: string,
  connectorIds: string[],
  maxResults = 12,
): Promise<AdapterResult> {
  const unknown = connectorIds.filter((id) => !isKnownSourceConnector(id));
  if (unknown.length > 0) {
    throw new Error(`Unknown source connector: ${unknown.join(", ")}`);
  }
  const selected = new Set(connectorIds);
  const liveAdapters = [
    { id: "google-news-rss", name: "Google News", run: searchGoogleNews },
    { id: "bing-news-rss", name: "Bing News", run: searchBingNews },
    { id: "federal-register", name: "Federal Register", run: searchFederalRegister },
    { id: "crossref", name: "Crossref Research", run: searchCrossref },
  ].filter((adapter) => selected.has(adapter.id));
  const perProvider = Math.max(2, Math.ceil(maxResults / Math.max(1, liveAdapters.length)));
  const settled = await Promise.allSettled(
    liveAdapters.map((adapter) => adapter.run(prompt, perProvider)),
  );
  const files: SourceFile[] = [];
  const notices: string[] = [];

  settled.forEach((outcome, index) => {
    const adapter = liveAdapters[index]!;
    if (outcome.status === "fulfilled") {
      files.push(...outcome.value);
      if (outcome.value.length === 0) {
        notices.push(`${adapter.name} returned no matching results.`);
      }
    } else {
      const message =
        outcome.reason instanceof Error ? outcome.reason.message : "unknown provider error";
      notices.push(`${adapter.name} was unavailable: ${message}.`);
    }
  });

  if (selected.has("demonstration-library")) {
    files.push(...generateDemonstrationFiles(prompt, perProvider));
    notices.push("Demonstration Library results are synthetic and are labeled in each record.");
  }

  return {
    files: files
      .sort((a, b) => b.relevance - a.relevance)
      .slice(0, Math.min(maxResults, 20)),
    notices,
  };
}