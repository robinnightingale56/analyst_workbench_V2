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

function result(score: number): StandardStatus {
  if (score >= 80) return "PASS";
  if (score >= 60) return "REVIEW";
  return "GAP";
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

  return {
    id: crypto.randomUUID(),
    selectedSourceFileIds: selected.map((item) => item.id),
    overallScore,
    summary:
      overallScore >= 80
        ? "The evidence package is broadly defensible, with focused revisions needed before dissemination."
        : "The evidence package is suitable for continued analysis but contains tradecraft gaps that should be resolved before dissemination.",
    standards: evaluated,
  };
}
