import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLocation } from 'wouter';

const state = vi.hoisted(() => ({
  session: undefined as unknown,
  connectors: [] as Array<Record<string, unknown>>,
  sessions: [] as Array<Record<string, unknown>>,
  currentEvents: undefined as unknown,
  createSessionMutate: vi.fn(),
  currentEventsCalls: [] as unknown[][],
}));

vi.mock('@workspace/api-client-react', () => ({
  AnalysisSessionClassification: { UNCLASSIFIED: 'UNCLASSIFIED', CUI: 'CUI', SECRET: 'SECRET', TS: 'TS' },
  AnalyticStandardStatus: { REVIEW: 'REVIEW' },
  SourceConnectorStatus: { READY: 'READY' },
  useCreateAnalysisSession: () => ({ mutate: state.createSessionMutate, isPending: false }),
  useCreateAssessment: () => ({ mutate: vi.fn(), isPending: false }),
  useGetAnalysisSession: () => ({ data: state.session, isLoading: false }),
  useListAnalysisSessions: () => ({ data: state.sessions, isLoading: false }),
  useListAnalysisStarters: () => ({ data: { recentQuestions: [], ongoingEvents: [] }, isLoading: false }),
  useListCurrentEvents: (...args: unknown[]) => {
    state.currentEventsCalls.push(args);
    return { data: state.currentEvents, isLoading: false, isFetching: false, error: undefined, refetch: vi.fn() };
  },
  useListSourceConnectors: () => ({ data: state.connectors, isLoading: false }),
  useListEvaluationVectors: () => ({ data: [], isLoading: false }),
  useRunResearch: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateIncidentReview: () => ({ mutate: vi.fn(), isPending: false }),
  useHealthCheck: () => ({ data: { status: 'ok' }, isLoading: false }),
  getAnalysisSession: vi.fn(),
  getGetAnalysisSessionQueryKey: (id: string) => ['analysis-session', id],
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  Show: ({ children }: { children: unknown }) => children,
  SignIn: () => null,
  SignUp: () => null,
  useClerk: () => ({ signOut: vi.fn() }),
  useUser: () => ({ user: null }),
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));
vi.mock('@clerk/react/internal', () => ({ publishableKeyFromHost: () => 'pk_test_unit_test' }));
vi.mock('@clerk/themes', () => ({ shadcn: {} }));

import { Home, SessionsPage } from './App';

function source(id: string) {
  return {
    id, title: `Source ${id}`, source: 'Test publisher', sourceType: 'NEWS',
    publishedAt: '2026-09-12T00:00:00Z', providerPublishedAt: '2026-09-12T00:00:00Z',
    publicationDateSource: 'PROVIDER', relevance: 0.9, reliability: 'HIGH',
    bluf: `BLUF ${id}`, keyPoints: [], tags: ['live'], url: `https://example.test/${id}`,
    retrievedAt: '2026-09-13T00:00:00Z', collectionMethod: 'Google News public RSS',
    content: `Source body ${id}`, contentDepth: 'EXCERPT',
  };
}

const connectors = [
  { id: 'live', name: 'Live', description: 'Public source', status: 'READY', mode: 'LIVE', sourceTypes: ['NEWS'] },
  { id: 'demo', name: 'Demo', description: 'Synthetic source', status: 'READY', mode: 'DEMONSTRATION', sourceTypes: ['NEWS'] },
];

describe('workbench resume and classification transitions', () => {
  beforeEach(() => {
    state.connectors = connectors;
    state.session = undefined;
    state.sessions = [];
    state.currentEvents = undefined;
    state.createSessionMutate.mockReset();
    state.currentEventsCalls = [];
    window.history.replaceState({}, '', '/user-portal');
  });
  afterEach(cleanup);

  it('keeps saved evidence selection when the real Sessions Open control navigates to a resumed workspace', async () => {
    state.session = {
      id: 'saved-session', prompt: 'Saved question', classification: 'UNCLASSIFIED',
      sourceConnectorIds: ['live'], status: 'COMPLETE', sourceFiles: [source('first'), source('second'), source('third')],
      assessment: {
        selectedSourceFileIds: ['second', 'third'], vectorResults: [], standards: [], overallScore: 50,
        summary: 'Saved draft', provisional: true, methodology: 'Test methodology', countAnswer: null,
      },
    };
    state.sessions = [state.session as Record<string, unknown>];
    window.history.replaceState({}, '', '/user-portal/sessions');
    function ActualSessionsOpenFlow() {
      const [location] = useLocation();
      return location.startsWith('/user-portal/sessions')
        ? <SessionsPage />
        : <Home />;
    }

    render(<ActualSessionsOpenFlow />);
    fireEvent.click(screen.getByTestId('button-open-session-saved-session'));

    await waitFor(() => expect(screen.getByTestId('button-select-source-second').getAttribute('aria-label')).toBe('Remove source from assessment'));
    expect(screen.getByTestId('button-select-source-third').getAttribute('aria-label')).toBe('Remove source from assessment');
    expect(screen.getByTestId('button-select-source-first').getAttribute('aria-label')).toBe('Select source for assessment');
  });

  it('normalizes selected providers when classification changes from public to restricted', async () => {
    render(<Home />);

    await waitFor(() => expect(screen.getByTestId('button-connector-live').getAttribute('aria-pressed')).toBe('true'));
    const initialCurrentEventsCall = state.currentEventsCalls.at(-1);
    expect(initialCurrentEventsCall?.[0]).toEqual({ classification: 'UNCLASSIFIED' });
    expect(initialCurrentEventsCall?.[1]).toEqual({ query: { enabled: true, queryKey: ['current-events', 'UNCLASSIFIED'] } });
    fireEvent.change(screen.getByTestId('select-classification'), { target: { value: 'CUI' } });

    await waitFor(() => {
      expect(screen.getByTestId('button-connector-live').getAttribute('aria-pressed')).toBe('false');
      expect((screen.getByTestId('button-connector-live') as HTMLButtonElement).disabled).toBe(true);
      expect(screen.getByTestId('button-connector-demo').getAttribute('aria-pressed')).toBe('true');
    });
    await waitFor(() => expect(state.currentEventsCalls.at(-1)?.[1]).toEqual({ query: { enabled: false, queryKey: ['current-events', 'CUI'] } }));
    expect(screen.getByTestId('state-current-events-restricted')).toBeTruthy();
  });

  it('uses a current event as an editable new question without mutating an existing session', async () => {
    state.session = {
      id: 'existing-session', prompt: 'Existing saved question', classification: 'UNCLASSIFIED',
      sourceConnectorIds: ['live'], status: 'COMPLETE', sourceFiles: [],
      assessment: null,
    };
    state.currentEvents = {
      events: [{
        id: 'event-1',
        title: 'Verified current event',
        question: 'What does this verified event mean for our decision?',
        url: 'https://news.example.test/event-1',
        provider: 'Test Wire',
        publishedAt: '2026-09-14T08:00:00Z',
        retrievedAt: '2026-09-14T09:00:00Z',
        freshness: 'CURRENT',
      }],
      providers: [{ provider: 'Test Wire', status: 'OK', message: 'Provider available' }],
      checkedAt: '2026-09-14T09:05:00Z',
      freshnessWindowHours: 24,
      blocked: false,
    };
    window.history.replaceState({}, '', '/user-portal?session=existing-session');

    render(<Home />);

    expect(screen.getByTestId('link-current-event-event-1').getAttribute('href')).toBe('https://news.example.test/event-1');
    fireEvent.click(screen.getByTestId('button-use-current-event-event-1'));

    await waitFor(() => expect((screen.getByTestId('input-research-prompt') as HTMLTextAreaElement).value).toBe('What does this verified event mean for our decision?'));
    expect(state.createSessionMutate).not.toHaveBeenCalled();
    expect(screen.queryByTestId('button-select-source-first')).toBeNull();
  });

  it.each(['CUI', 'SECRET'])('does not enable or display public current events before a saved %s classification is hydrated', async (savedClassification) => {
    const sessionId = `saved-${savedClassification.toLowerCase()}`;
    state.session = {
      id: sessionId,
      prompt: 'Saved restricted question',
      classification: savedClassification,
      sourceConnectorIds: ['demo'],
      status: 'COMPLETE',
      sourceFiles: [],
      assessment: null,
    };
    state.currentEvents = {
      events: [{
        id: 'cached-public-event',
        title: 'Cached public headline must stay hidden',
        question: 'A cached question',
        url: 'https://news.example.test/cached',
        provider: 'Public provider',
        publishedAt: '2026-09-14T08:00:00Z',
        retrievedAt: '2026-09-14T09:00:00Z',
        freshness: 'CURRENT',
      }],
      providers: [{ provider: 'Public provider', status: 'OK', message: 'Available' }],
      checkedAt: '2026-09-14T09:05:00Z',
      freshnessWindowHours: 24,
      blocked: false,
    };
    window.history.replaceState({}, '', `/user-portal?session=${sessionId}`);

    render(<Home />);

    expect(screen.queryByText('Cached public headline must stay hidden')).toBeNull();
    expect(state.currentEventsCalls.length).toBeGreaterThan(0);
    expect(state.currentEventsCalls.every((call) => (call[1] as { query: { enabled: boolean } }).query.enabled === false)).toBe(true);
    await waitFor(() => expect(screen.getByTestId('state-current-events-restricted')).toBeTruthy());
    expect(screen.queryByTestId('link-current-event-cached-public-event')).toBeNull();
  });
});