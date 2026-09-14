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

export function assessSources(selected: SourceFile[]) {
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
  };
}
