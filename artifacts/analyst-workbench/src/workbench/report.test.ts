import { describe, expect, it } from 'vitest';
import { buildAnalyticReviewHtml, buildAnalyticReviewReport } from './report';

function session() {
  return {
    id: 'session-12345678',
    prompt: 'What does <unsafe> reporting indicate?',
    sourceFiles: [{
      id: 'source-1',
      title: 'Report <title>',
      source: 'Publisher & partner',
      url: 'https://example.test/report?x=<value>',
      publishedAt: '2026-01-03T00:00:00Z',
      retrievedAt: '2026-01-04T00:00:00Z',
      contentDepth: 'EXCERPT',
      content: 'Exact <source> passage & context.',
    }, {
      id: 'metadata-source',
      title: 'Metadata-only report',
      source: 'Metadata publisher',
      url: 'https://example.test/metadata',
      publishedAt: '2026-01-05T00:00:00Z',
      retrievedAt: '2026-01-06T00:00:00Z',
      contentDepth: 'METADATA',
      content: 'Should not appear as a passage',
    }],
    assessment: {
      selectedSourceFileIds: ['source-1', 'metadata-source'],
      overallScore: 71,
      summary: 'A provisional summary.',
      methodology: 'Metadata heuristic only.',
      standards: [
        { id: 'alternatives', name: 'Alternatives', score: 50, status: 'GAP', finding: 'Test a competing explanation.' },
        { id: 'fact', name: 'Fact vs. Judgment', score: 60, status: 'REVIEW', finding: 'Label assumptions and judgments.' },
      ],
      countAnswer: {
        answerStatus: 'SUPPORTED',
        provisionalCount: 1,
        confidence: 'LOW',
        inclusionCriteria: 'Exact cited support is required.',
        incidents: [{
          status: 'INCLUDED',
          sourceFileIds: ['source-1'],
          evidenceSpans: [{ sourceFileId: 'source-1', text: 'Exact <source> passage', startChar: 0, endChar: 22 }],
        }],
      },
    },
  } as never;
}

describe('analytic review export', () => {
  it('includes only selected evidence, gaps, and exact available support', () => {
    const report = buildAnalyticReviewReport(session(), '2026-02-03T00:00:00Z');
    expect(report.sources).toHaveLength(2);
    expect(report.sources[0].evidenceSpans).toEqual(['Exact <source> passage']);
    expect(report.sources[1].passage).toBeNull();
    expect(report.assessment.informationGaps).toContain('Test a competing explanation.');
    expect(report.assessment.assumptions).toContain('Label assumptions and judgments.');
  });

  it('escapes report-provided text and explicitly marks missing passages', () => {
    const html = buildAnalyticReviewHtml(buildAnalyticReviewReport(session()));
    expect(html).toContain('What does &lt;unsafe&gt; reporting indicate?');
    expect(html).toContain('Exact &lt;source&gt; passage');
    expect(html).not.toContain('What does <unsafe> reporting indicate?');
    expect(html).toContain('No extractable passage was available; this record is metadata only.');
  });

  it('does not emit an executable source URL into the downloaded report', () => {
    const unsafe = session();
    unsafe.sourceFiles[0].url = 'javascript:alert(1)';
    const html = buildAnalyticReviewHtml(buildAnalyticReviewReport(unsafe));
    expect(html).toContain('href="#"');
    expect(html).toContain('javascript:alert(1)');
  });
});