type SourceFile = {
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
  content: string;
  contentDepth: "FULL_TEXT" | "EXCERPT" | "METADATA";
};

type StandardStatus = "PASS" | "REVIEW" | "GAP";

const standards = [
  {
    id: "source-quality",
    shortName: "Source Quality",
    name: "Properly describes the quality and credibility of underlying sources",
    prompt: "Are source quality, credibility, access, and possible bias clearly described?",
  },
  {
    id: "uncertainty",
    shortName: "Uncertainty",
    name: "Properly expresses and explains uncertainties associated with major analytic judgments",
    prompt: "Are confidence and uncertainty stated and tied to the evidence?",
  },
  {
    id: "distinctions",
    shortName: "Fact vs. Judgment",
    name: "Properly distinguishes between underlying intelligence and analysts' assumptions and judgments",
    prompt: "Can the reader distinguish reporting, assumptions, and analytic judgment?",
  },
  {
    id: "alternatives",
    shortName: "Alternatives",
    name: "Incorporates analysis of alternatives",
    prompt: "Were plausible competing explanations or outcomes considered?",
  },
  {
    id: "relevance",
    shortName: "Customer Relevance",
    name: "Demonstrates customer relevance and addresses implications",
    prompt: "Does the assessment answer the intelligence question and explain implications?",
  },
  {
    id: "argumentation",
    shortName: "Logical Argument",
    name: "Uses clear and logical argumentation",
    prompt: "Do judgments follow from cited evidence through a clear line of reasoning?",
  },
  {
    id: "change",
    shortName: "Change or Consistency",
    name: "Explains change to or consistency of analytic judgments",
    prompt: "Are changes from previous judgments, or reasons for consistency, explained?",
  },
  {
    id: "accuracy",
    shortName: "Accuracy",
    name: "Makes accurate judgments and assessments",
    prompt: "Are claims bounded, internally consistent, and supported by the selected evidence?",
  },
  {
    id: "visuals",
    shortName: "Effective Visuals",
    name: "Incorporates effective visual information where appropriate",
    prompt: "Would a timeline, map, table, or relationship view improve comprehension?",
  },
] as const;

export const evaluationVectors = [
  {
    id: "vector-a",
    name: "Consumer Indicies",
    description: "Stand-in vector measuring changes across selected consumer indicators.",
    weight: 0.17,
    placeholder: true,
  },
  {
    id: "vector-b",
    name: "Economic Leverage",
    description: "Stand-in vector measuring evidenced economic influence and constraints.",
    weight: 0.17,
    placeholder: true,
  },
  {
    id: "vector-c",
    name: "Geo-Strategic",
    description: "Stand-in vector measuring geographic and strategic implications.",
    weight: 0.17,
    placeholder: true,
  },
  {
    id: "vector-d",
    name: "Subscriber Accounts",
    description: "Stand-in vector measuring changes in the scale and quality of subscriber accounts.",
    weight: 0.16,
    placeholder: true,
  },
  {
    id: "vector-e",
    name: "Consumer Product Entries",
    description: "Stand-in vector measuring the volume and significance of consumer product entries.",
    weight: 0.16,
    placeholder: true,
  },
  {
    id: "vector-f",
    name: "Consumer Preferences",
    description: "Stand-in vector measuring observable changes in consumer preference.",
    weight: 0.17,
    placeholder: true,
  },
] as const;

export const historicalRatings = [
  {
    year: 2022,
    rating: "LOW" as const,
    score: 42,
    summary: "Stand-in history: limited activity and uneven corroboration produced a low baseline rating.",
    placeholder: true,
  },
  {
    year: 2023,
    rating: "MODERATE" as const,
    score: 55,
    summary: "Stand-in history: broader reporting and improved indicators supported an increase.",
    placeholder: true,
  },
  {
    year: 2024,
    rating: "MODERATE" as const,
    score: 59,
    summary: "Stand-in history: the rating remained moderate as growth indicators were offset by sustainment gaps.",
    placeholder: true,
  },
  {
    year: 2025,
    rating: "MODERATE" as const,
    score: 63,
    summary: "Stand-in history: several indicators strengthened, but the scenario did not support the next rating band.",
    placeholder: true,
  },
];

function result(score: number): StandardStatus {
  if (score >= 80) return "PASS";
  if (score >= 60) return "REVIEW";
  return "GAP";
}

function vectorStatus(score: number) {
  if (score >= 75) return "STRONG" as const;
  if (score >= 55) return "MIXED" as const;
  return "WEAK" as const;
}

function ratingForScore(score: number) {
  if (score >= 85) return "CRITICAL" as const;
  if (score >= 70) return "HIGH" as const;
  if (score >= 45) return "MODERATE" as const;
  return "LOW" as const;
}

const eventTermPattern =
  String.raw`clash(?:ed|es|ing)?|fight(?:s|ing)?|fought|exchange(?:s|d|ing)? fire|skirmish(?:ed|es|ing)?`;
const eventTermRegex = new RegExp(String.raw`\b(?:${eventTermPattern})\b`, "i");
const unsupportedClaimRegex =
  /\b(?:no|not|never|den(?:y|ied|ies)|may|might|could|would|will|possible|possibly|potential|expected|forecast|planned|plans|report denied|without|whether|if)\b|n't\b/i;

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sentenceLinksPartiesToEvent(sentence: string, parties: string[]) {
  if (parties.length !== 2 || parties.some((party) => !party.trim())) return false;
  const pairs = [
    [escapeRegExp(parties[0]!.trim()), escapeRegExp(parties[1]!.trim())],
    [escapeRegExp(parties[1]!.trim()), escapeRegExp(parties[0]!.trim())],
  ];
  return pairs.some(([left, right]) => [
    new RegExp(String.raw`\b${left}\b\s+(?:and|&)\s+\b${right}\b(?:\s+\w+){0,5}\s+(?:${eventTermPattern})\b`, "i"),
    new RegExp(String.raw`\b${left}\b(?:\s+\w+){0,4}\s+(?:${eventTermPattern})\s+(?:with|against|versus|vs\.?)\s+\b${right}\b`, "i"),
    new RegExp(String.raw`(?:${eventTermPattern})(?:\s+\w+){0,5}\s+between\s+\b${left}\b\s+and\s+\b${right}\b`, "i"),
  ].some((pattern) => pattern.test(sentence)));
}

export type Incident = {
  id: string;
  date: string;
  location: string;
  parties: string[];
  description: string;
  sourceFileIds: string[];
  status: "INCLUDED" | "EXCLUDED";
};

export function sourceSupportsIncident(source: SourceFile, incident: Incident) {
  if (source.contentDepth === "METADATA") return false;
  return source.content
    .split(/(?<=[.!?])\s+/)
    .some((sentence) => {
      const date = extractIncidentDate(sentence);
      const supportsParties = sentenceLinksPartiesToEvent(sentence, incident.parties);
      const supportsLocation =
        incident.location === "Location not established" ||
        sentence.toLowerCase().includes(incident.location.toLowerCase());
      const descriptionTerms = similarityTerms(incident.description, incident.parties);
      const sentenceTerms = similarityTerms(sentence, incident.parties);
      const descriptionOverlap = [...descriptionTerms]
        .filter((term) => sentenceTerms.has(term)).length;
      const supportsDescription =
        descriptionTerms.size > 0 &&
        descriptionOverlap / descriptionTerms.size >= 0.5;
      return Boolean(
        date &&
        date.slice(0, 10) === incident.date.slice(0, 10) &&
        eventTermRegex.test(sentence) &&
        !unsupportedClaimRegex.test(sentence) &&
        supportsParties &&
        supportsLocation &&
        supportsDescription
      );
    });
}

export function incidentCitationError(
  incident: Incident,
  selectedSources: SourceFile[],
  requestedParties = incident.parties,
  dateRange: { startDate: string; endDate: string } | null = null,
) {
  const normalizedExpected = requestedParties.map((party) => party.trim().toLowerCase()).sort();
  const normalizedActual = incident.parties.map((party) => party.trim().toLowerCase()).sort();
  if (
    normalizedActual.some((party) => party.length === 0) ||
    normalizedExpected.length !== normalizedActual.length ||
    normalizedExpected.some((party, index) => party !== normalizedActual[index])
  ) {
    return "Incident parties must match the parties requested in the count question";
  }
  if (
    dateRange &&
    (incident.date.slice(0, 10) < dateRange.startDate || incident.date.slice(0, 10) > dateRange.endDate)
  ) {
    return "Incident date falls outside the period requested in the count question";
  }
  if (incident.sourceFileIds.length === 0) return "Every included incident requires a citation";
  const selectedById = new Map(selectedSources.map((source) => [source.id, source]));
  for (const sourceId of incident.sourceFileIds) {
    const source = selectedById.get(sourceId);
    if (!source) return "Incident citations must belong to the selected evidence set";
    if (source.contentDepth === "METADATA") return "Metadata-only records cannot support a finalized incident";
    if (!sourceSupportsIncident(source, incident)) {
      return "A cited source does not support the incident parties, date, event, and location";
    }
  }
  return null;
}

function extractParties(question: string) {
  const patterns = [
    new RegExp(String.raw`^how many times (?:did|have|has)\s+([a-z][\w .'-]{1,40}?)\s+(?:and|with|versus|vs\.?)\s+([a-z][\w .'-]{1,40}?)\s+(?:${eventTermPattern})\s*[?.]*$`, "i"),
    new RegExp(String.raw`^how many times (?:did|have|has)\s+([a-z][\w .'-]{1,40}?)\s+(?:${eventTermPattern})\s+(?:with|against|versus|vs\.?)\s+([a-z][\w .'-]{1,40}?)\s*[?.]*$`, "i"),
    /^how many (?:clashes|fights|skirmishes)(?:\s+\w+){0,4}\s+between\s+([a-z][\w .'-]{1,40}?)\s+(?:and|versus|vs\.?)\s+([a-z][\w .'-]{1,40}?)\s*[?.]*$/i,
    /^(?:what (?:is|was) )?(?:the )?(?:number|count) of (?:clashes|fights|skirmishes)(?:\s+\w+){0,4}\s+between\s+([a-z][\w .'-]{1,40}?)\s+(?:and|versus|vs\.?)\s+([a-z][\w .'-]{1,40}?)\s*[?.]*$/i,
  ];
  for (const pattern of patterns) {
    const match = question.match(pattern);
    if (match?.[1] && match[2]) return [match[1].trim(), match[2].trim()];
  }
  return null;
}

function extractIncidentDate(text: string) {
  const match = text.match(/\b(?:on\s+)?(\d{1,2}\s+[A-Z][a-z]+\s+\d{4}|[A-Z][a-z]+\s+\d{1,2},?\s+\d{4}|\d{4}-\d{2}-\d{2})\b/);
  if (match?.[1] && !Number.isNaN(Date.parse(match[1]))) {
    return new Date(match[1]).toISOString();
  }
  return null;
}

function extractLocation(text: string) {
  const match = text.match(/\b(?:in|near|at|along)\s+(?:the\s+)?([A-Z][A-Za-z0-9' -]{2,60}?)(?=[,.;]|\s+(?:on|after|before|where|when|border)\b)/);
  return match?.[1]?.trim() || "Location not established";
}

function similarityTerms(text: string, parties: string[]) {
  const ignored = new Set([
    "clash", "clashed", "clashes", "exchange", "exchanged", "fire",
    "country", "september", "october", "november", "december",
    ...parties.flatMap((party) => party.toLowerCase().split(/[^a-z0-9]+/)),
  ]);
  return new Set(
    text.toLowerCase().split(/[^a-z0-9]+/)
      .filter((term) => term.length > 3 && !ignored.has(term)),
  );
}

function sameIncident(left: Incident, right: Incident) {
  if (left.date.slice(0, 10) !== right.date.slice(0, 10)) return false;
  const leftLocation = left.location.toLowerCase();
  const rightLocation = right.location.toLowerCase();
  const leftKnown = leftLocation !== "location not established";
  const rightKnown = rightLocation !== "location not established";
  if (leftKnown && rightKnown && leftLocation !== rightLocation) return false;
  const leftTerms = similarityTerms(left.description, left.parties);
  const rightTerms = similarityTerms(right.description, right.parties);
  const overlap = [...leftTerms].filter((term) => rightTerms.has(term)).length;
  const denominator = Math.max(1, Math.min(leftTerms.size, rightTerms.size));
  return leftKnown && rightKnown ? overlap / denominator >= 0.25 : overlap / denominator >= 0.6;
}

export function deduplicateIncidents(input: Incident[]) {
  const incidents: Incident[] = [];
  for (const candidate of input) {
    const duplicate = incidents.find((incident) => sameIncident(incident, candidate));
    if (!duplicate) {
      incidents.push({
        ...candidate,
        parties: [...candidate.parties],
        sourceFileIds: [...new Set(candidate.sourceFileIds)],
      });
      continue;
    }
    duplicate.sourceFileIds = [...new Set([
      ...duplicate.sourceFileIds,
      ...candidate.sourceFileIds,
    ])];
    if (candidate.description.length > duplicate.description.length) {
      duplicate.description = candidate.description;
    }
    if (candidate.status === "INCLUDED") duplicate.status = "INCLUDED";
  }
  return incidents;
}

export function buildCountAnswer(question: string, selected: SourceFile[]) {
  const yearMatch = question.match(/\s+(?:in|during)\s+((?:19|20)\d{2})\s*[?.]*$/i);
  const normalizedQuestion = yearMatch
    ? question.slice(0, yearMatch.index).trim().replace(/[?.]+$/, "")
    : question;
  const dateRange = yearMatch
    ? { startDate: `${yearMatch[1]}-01-01`, endDate: `${yearMatch[1]}-12-31` }
    : null;
  const parties = extractParties(normalizedQuestion);
  const countIntent = /\b(how many|number of|count)\b/i.test(normalizedQuestion) &&
    eventTermRegex.test(normalizedQuestion);
  if (!countIntent || !parties) return null;
  const candidates: Incident[] = [];
  for (const source of selected) {
    if (source.contentDepth === "METADATA") continue;
    const sentences = source.content
      .split(/(?<=[.!?])\s+/)
      .filter(Boolean);
    sentences.forEach((sentence) => {
      const supportsBothParties = sentenceLinksPartiesToEvent(sentence, parties);
      const date = extractIncidentDate(sentence);
      if (
        !eventTermRegex.test(sentence) ||
        unsupportedClaimRegex.test(sentence) ||
        !supportsBothParties ||
        !date
      ) return;
      if (
        dateRange &&
        (date.slice(0, 10) < dateRange.startDate || date.slice(0, 10) > dateRange.endDate)
      ) return;
      candidates.push({
        id: crypto.randomUUID(),
        date,
        location: extractLocation(sentence),
        parties,
        description: sentence,
        sourceFileIds: [source.id],
        status: "INCLUDED",
      });
    });
  }
  const incidents = deduplicateIncidents(candidates);
  const corroborated = incidents.filter((incident) => incident.sourceFileIds.length > 1).length;
  const confidence = incidents.length === 0 ? "LOW" : corroborated > 0 || selected.some((source) => source.reliability === "HIGH") ? "MODERATE" : "LOW";
  return {
    question,
    requestedParties: parties,
    eventType: "PHYSICAL_CLASH" as const,
    dateRange,
    provisionalCount: incidents.length,
    confidence: confidence as "LOW" | "MODERATE" | "HIGH",
    answerStatus: incidents.length > 0 ? "SUPPORTED" as const : "INSUFFICIENT_EVIDENCE" as const,
    inclusionCriteria: `Distinct physical clashes or exchanges of fire that name both requested parties and state an event date${dateRange ? ` within ${yearMatch?.[1]}` : ""}. Reports with the same event date, compatible location, and substantially overlapping event details are consolidated as one incident.`,
    incidents,
    finalized: false,
  };
}

export function assessSources(selected: SourceFile[], question = "") {
  const sourceCount = selected.length;
  const highReliability = selected.filter((item) => item.reliability === "HIGH").length;
  const sourceTypes = new Set(selected.map((item) => item.sourceType)).size;
  const avgRelevance =
    sourceCount === 0
      ? 0
      : selected.reduce((total, item) => total + item.relevance, 0) / sourceCount;

  const scores = [
    Math.min(96, 48 + highReliability * 13 + sourceTypes * 5),
    Math.min(88, 54 + sourceCount * 4),
    Math.min(92, 58 + sourceCount * 5),
    Math.min(86, 42 + sourceTypes * 12),
    Math.round(avgRelevance * 100),
    Math.min(91, 57 + sourceCount * 5),
    sourceCount >= 4 ? 72 : 49,
    Math.min(94, 50 + highReliability * 11 + Math.round(avgRelevance * 18)),
    sourceTypes >= 3 ? 76 : 55,
  ];

  const findings = [
    highReliability >= 2
      ? `${highReliability} selected sources are rated high reliability; retain the basis for each rating in the final product.`
      : "The evidence set needs stronger source-credibility characterization before publication.",
    "Confidence language is not yet tied to specific judgments; add confidence statements and identify the key intelligence gaps.",
    "BLUFs preserve reported facts, but the final synthesis must label assumptions and analytic judgments explicitly.",
    sourceTypes >= 3
      ? "The evidence set supports competing-hypothesis review across multiple source classes."
      : "Add a plausible alternative explanation and identify evidence that would confirm or refute it.",
    avgRelevance >= 0.8
      ? "The selected reporting is directly responsive to the analyst's stated intelligence question."
      : "Some selected reporting is only indirectly relevant; tighten the evidence set or explain the linkage.",
    "The evidence can support a clear argument, but each major judgment should link to specific reporting.",
    "No prior assessment is attached. State whether the judgment is new, changed, or consistent with previous analysis.",
    highReliability >= 2
      ? "The evidence base is sufficiently credible for a draft judgment, subject to explicit caveats."
      : "Accuracy risk remains elevated because the selected set has limited high-reliability reporting.",
    sourceTypes >= 3
      ? "A source-comparison matrix or chronology would improve rapid comprehension."
      : "A simple evidence table would make source gaps and corroboration easier to review.",
  ];

  const evaluated = standards.map((standard, index) => ({
    ...standard,
    score: scores[index] ?? 0,
    status: result(scores[index] ?? 0),
    finding: findings[index] ?? "",
  }));
  const overallScore = Math.round(
    evaluated.reduce((total, standard) => total + standard.score, 0) /
      evaluated.length,
  );
  const vectorScores = [
    Math.min(94, 45 + sourceCount * 7 + sourceTypes * 3),
    Math.min(96, 42 + highReliability * 14 + Math.round(avgRelevance * 18)),
    Math.min(90, 38 + sourceTypes * 13),
    Math.min(88, 44 + highReliability * 9 + sourceCount * 4),
    Math.min(93, 40 + sourceTypes * 8 + Math.round(avgRelevance * 20)),
    Math.min(91, 43 + sourceCount * 5 + Math.round(avgRelevance * 17)),
  ];
  const vectorResults = evaluationVectors.map((vector, index) => {
    const score = vectorScores[index] ?? 0;
    return {
      id: vector.id,
      name: vector.name,
      weight: vector.weight,
      score,
      status: vectorStatus(score),
      rationale:
        score >= 75
          ? `POC heuristic: source volume, diversity, and assigned reliability produce a strong signal for ${vector.name.toLowerCase()}; report content has not yet been machine-evaluated against this vector.`
          : score >= 55
            ? `POC heuristic: source metadata produces a mixed signal for ${vector.name.toLowerCase()}; content-grounded review is still required.`
            : `POC heuristic: source metadata is insufficient to produce a strong signal for ${vector.name.toLowerCase()}; this is not a substantive analytic finding.`,
      evidenceSourceFileIds: selected
        .filter((_, sourceIndex) => sourceIndex % evaluationVectors.length <= index)
        .slice(0, 3)
        .map((item) => item.id),
    };
  });
  const currentScore = Math.round(
    vectorResults.reduce((total, vector) => total + vector.score * vector.weight, 0),
  );
  const previous = historicalRatings[historicalRatings.length - 1]!;
  const delta = currentScore - previous.score;
  const direction = delta >= 6 ? ("UP" as const) : delta <= -6 ? ("DOWN" as const) : ("SAME" as const);
  const recommendedRating = ratingForScore(currentScore);
  const evidenceConfidence = "LOW" as const;
  const strongest = [...vectorResults].sort((a, b) => b.score - a.score)[0]!;
  const weakest = [...vectorResults].sort((a, b) => a.score - b.score)[0]!;
  const directionLanguage =
    direction === "UP" ? "increase" : direction === "DOWN" ? "decrease" : "maintain";
  const trendAnalysis = {
    direction,
    previousRating: previous.rating,
    recommendedRating,
    confidence: evidenceConfidence,
    rationale: `Provisional POC signal only: the weighted stand-in-vector metadata score is ${currentScore}, compared with the synthetic ${previous.year} baseline of ${previous.score}. The heuristic indicates ${directionLanguage}, but an analyst must review report content and approve or reject this result. ${strongest.name} is the strongest computed driver, while ${weakest.name} is the principal limiting factor.`,
    drivers: [
      `${strongest.name}: ${strongest.score}/100 — strongest evidenced condition.`,
      `${weakest.name}: ${weakest.score}/100 — primary uncertainty or collection gap.`,
      `${highReliability} of ${sourceCount} selected reports are rated high reliability.`,
      `${sourceTypes} distinct source classes contribute to the current assessment.`,
    ],
  };

  return {
    id: crypto.randomUUID(),
    selectedSourceFileIds: selected.map((item) => item.id),
    overallScore,
    summary:
      overallScore >= 80
        ? "The evidence package is broadly defensible, with focused revisions needed before dissemination."
        : "The evidence package is suitable for continued analysis but contains tradecraft gaps that should be resolved before dissemination.",
    provisional: true,
    methodology:
      "Proof-of-concept heuristic based on source count, source-class diversity, assigned source reliability, and retrieval relevance. It does not yet evaluate full report content against the six vectors and must not be treated as a final analytic rating.",
    standards: evaluated,
    vectorResults,
    historicalRatings,
    trendAnalysis,
    countAnswer: buildCountAnswer(question, selected),
  };
}
