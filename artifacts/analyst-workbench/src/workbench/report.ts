import type { AnalysisSession, SourceFile } from '@workspace/api-client-react';

export type AnalyticReviewReport = {
  title: string;
  generatedAt: string;
  question: string;
  assessment: {
    answer: string;
    confidenceExplanation: string;
    methodology: string;
    informationGaps: string[];
    assumptions: string[];
    alternatives: string[];
    standards: Array<{ name: string; score: number; status: string; finding: string }>;
  };
  sources: Array<{
    title: string;
    publisher: string;
    url: string;
    publishedAt: string;
    retrievedAt: string;
    contentDepth: string;
    passage: string | null;
    evidenceSpans: string[];
  }>;
};

const escapeHtml = (value: string) => value
  .replaceAll('&', '&amp;')
  .replaceAll('<', '&lt;')
  .replaceAll('>', '&gt;')
  .replaceAll('"', '&quot;')
  .replaceAll("'", '&#39;');

function safeHref(value: string): string {
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : '#';
  } catch {
    return '#';
  }
}

function sourcePassage(source: SourceFile): string | null {
  if (source.contentDepth === 'METADATA') return null;
  const text = source.content.trim();
  return text ? text.slice(0, 900) : null;
}

function selectedSources(session: AnalysisSession): SourceFile[] {
  const ids = new Set(session.assessment?.selectedSourceFileIds ?? []);
  return session.sourceFiles.filter((source) => ids.has(source.id));
}

export function buildAnalyticReviewReport(session: AnalysisSession, generatedAt = new Date().toISOString()): AnalyticReviewReport {
  const assessment = session.assessment;
  if (!assessment) throw new Error('An assessment is required before exporting an analytic review report.');
  const answer = assessment.countAnswer
    ? assessment.countAnswer.answerStatus === 'SUPPORTED'
      ? `Provisional count: ${assessment.countAnswer.provisionalCount} supported incident${assessment.countAnswer.provisionalCount === 1 ? '' : 's'}.`
      : 'Insufficient evidence for a factual count. This is not evidence of zero incidents.'
    : assessment.summary;
  const standards = assessment.standards.map((standard) => ({
    name: standard.name,
    score: standard.score,
    status: standard.status,
    finding: standard.finding,
  }));
  const findingFor = (name: string) => standards.filter((standard) => standard.name.toLowerCase().includes(name)).map((standard) => standard.finding);
  const informationGaps = standards
    .filter((standard) => standard.status !== 'PASS')
    .map((standard) => standard.finding);
  const incidentSpans = assessment.countAnswer?.incidents ?? [];

  return {
    title: 'Analyst Workbench — Provisional Analytic Review',
    generatedAt,
    question: session.prompt,
    assessment: {
      answer,
      confidenceExplanation: assessment.countAnswer
        ? `${assessment.countAnswer.confidence} confidence. ${assessment.countAnswer.inclusionCriteria}`
        : `No independent confidence value was generated. Overall score ${assessment.overallScore}/100 is a provisional metadata heuristic, not a confidence judgment.`,
      methodology: assessment.methodology,
      informationGaps: informationGaps.length ? informationGaps : ['No structured information gaps were generated; review the selected evidence before release.'],
      assumptions: findingFor('fact vs. judgment').length
        ? findingFor('fact vs. judgment')
        : ['No separately structured assumptions were captured in this assessment.'],
      alternatives: findingFor('alternative').length
        ? findingFor('alternative')
        : ['No separately structured alternatives were captured in this assessment.'],
      standards,
    },
    sources: selectedSources(session).map((source) => ({
      title: source.title,
      publisher: source.source,
      url: source.url,
      publishedAt: source.publishedAt,
      retrievedAt: source.retrievedAt,
      contentDepth: source.contentDepth,
      passage: sourcePassage(source),
      evidenceSpans: incidentSpans
        .filter((incident) => incident.status === 'INCLUDED' && incident.sourceFileIds.includes(source.id))
        .flatMap((incident) => (incident.evidenceSpans ?? [])
          .filter((span) => span.sourceFileId === source.id)
          .map((span) => span.text)),
    })),
  };
}

function list(items: string[]) {
  return items.length ? `<ul>${items.map((item) => `<li>${escapeHtml(item)}</li>`).join('')}</ul>` : '<p>None recorded.</p>';
}

export function buildAnalyticReviewHtml(report: AnalyticReviewReport): string {
  const sources = report.sources.map((source, index) => `
    <article>
      <h3>${index + 1}. ${escapeHtml(source.title)}</h3>
      <p><strong>Publisher:</strong> ${escapeHtml(source.publisher)}<br>
      <strong>Published:</strong> ${escapeHtml(source.publishedAt)} &nbsp; <strong>Retrieved:</strong> ${escapeHtml(source.retrievedAt)}<br>
      <strong>Source URL:</strong> <a href="${escapeHtml(safeHref(source.url))}">${escapeHtml(source.url)}</a></p>
      ${source.passage ? `<p><strong>Available ${source.contentDepth === 'FULL_TEXT' ? 'passage' : 'excerpt'}:</strong> ${escapeHtml(source.passage)}</p>` : '<p><strong>Available passage:</strong> No extractable passage was available; this record is metadata only.</p>'}
      ${source.evidenceSpans.length ? `<p><strong>Exact incident evidence:</strong></p>${list(source.evidenceSpans)}` : ''}
    </article>`).join('');
  const standards = report.assessment.standards.map((standard) =>
    `<li><strong>${escapeHtml(standard.name)} — ${standard.score}/100 (${escapeHtml(standard.status)})</strong><br>${escapeHtml(standard.finding)}</li>`,
  ).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(report.title)}</title>
  <style>body{font:15px/1.5 system-ui,sans-serif;max-width:900px;margin:32px auto;padding:0 24px;color:#182235}h1,h2,h3{line-height:1.2}article{border-top:1px solid #ccd4df;padding:14px 0}a{overflow-wrap:anywhere}li{margin:8px 0}.notice{background:#fff5d8;border-left:4px solid #bd7a00;padding:12px}</style></head><body>
  <h1>${escapeHtml(report.title)}</h1><p class="notice"><strong>Provisional review only.</strong> This report is an analyst aid, not a release-authorized intelligence product or a formal ICD-203 determination. Vector scores use source metadata heuristics and are not content-grounded ratings.</p>
  <p><strong>Generated:</strong> ${escapeHtml(report.generatedAt)}</p><h2>Question</h2><p>${escapeHtml(report.question)}</p>
  <h2>Drafted answer</h2><p>${escapeHtml(report.assessment.answer)}</p><h2>Confidence and method</h2><p>${escapeHtml(report.assessment.confidenceExplanation)}</p><p>${escapeHtml(report.assessment.methodology)}</p>
  <h2>Information gaps</h2>${list(report.assessment.informationGaps)}<h2>Assumptions</h2>${list(report.assessment.assumptions)}<h2>Alternatives</h2>${list(report.assessment.alternatives)}
  <h2>Provisional ICD-203 review findings</h2><ul>${standards}</ul><h2>Selected evidence actually used</h2>${sources || '<p>No selected evidence was recorded.</p>'}
  </body></html>`;
}

export function downloadAnalyticReviewReport(session: AnalysisSession) {
  const report = buildAnalyticReviewReport(session);
  const blob = new Blob([buildAnalyticReviewHtml(report)], { type: 'text/html;charset=utf-8' });
  const href = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = href;
  link.download = `analytic-review-${session.id.slice(0, 8)}.html`;
  link.style.display = 'none';
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(href), 0);
}
