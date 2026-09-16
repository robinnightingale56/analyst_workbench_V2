import type { AnalysisSession, AnalysisSessionClassification, SourceFile } from '@workspace/api-client-react';

export type OngoingEventSuggestion = {
  sessionId: string;
  title: string;
  question: string;
  sourceTitle: string;
  sourceUrl: string;
  publishedAt: string;
  retrievedAt: string;
};

export type AnalysisStarters = {
  recentQuestions: Array<{
    sessionId: string;
    prompt: string;
    classification: keyof typeof AnalysisSessionClassification;
    updatedAt: string;
  }>;
  ongoingEvents: OngoingEventSuggestion[];
};

export const suggestedTopics = [
  'What developments should decision-makers monitor over the next 30 days?',
  'What evidence supports or challenges the reported operating-environment shift?',
  'What indicators would change the current provisional judgment?',
];

export function restoreWorkspaceForm(session: AnalysisSession) {
  return {
    prompt: session.prompt,
    classification: session.classification as keyof typeof AnalysisSessionClassification,
    selectedConnectors: session.sourceConnectorIds ?? [],
    selectedSources: session.assessment?.selectedSourceFileIds ?? [],
  };
}

export function sourceIsLive(source: SourceFile): boolean {
  return source.tags.some((tag) => tag.toLowerCase() === 'live')
    || /public (rss|api|rest)|google news|bing news|federal register|crossref/i.test(source.collectionMethod);
}
