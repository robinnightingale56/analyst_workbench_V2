import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { mutate, getAnalysisSession } = vi.hoisted(() => ({
  mutate: vi.fn(),
  getAnalysisSession: vi.fn(),
}));

vi.mock('@workspace/api-client-react', () => ({
  AnalysisSessionClassification: {},
  AnalyticStandardStatus: { REVIEW: 'REVIEW' },
  SourceConnectorStatus: {},
  useUpdateIncidentReview: () => ({ mutate, isPending: false }),
  getAnalysisSession,
}));

vi.mock('@clerk/react', () => ({
  ClerkProvider: ({ children }: { children: unknown }) => children,
  Show: ({ children }: { children: unknown }) => children,
  SignIn: () => null,
  SignUp: () => null,
  useClerk: () => ({ addListener: () => () => {}, signOut: vi.fn() }),
  useUser: () => ({ user: null }),
  useAuth: () => ({ isLoaded: true, isSignedIn: false }),
}));

vi.mock('@clerk/react/internal', () => ({
  publishableKeyFromHost: () => 'pk_test_unit_test',
}));

vi.mock('@clerk/themes', () => ({ shadcn: {} }));

import { CountAnswerReview } from './App';

const originalServerIncident = {
  id: 'incident-1',
  date: '2026-09-14T12:00:00.000Z',
  location: 'Original server location',
  parties: ['Party A'],
  description: 'Original server review incident',
  sourceFileIds: ['source-1'],
  evidenceSpans: [{
    sourceFileId: 'source-1',
    text: 'Original server review incident',
    startChar: 0,
    endChar: 31,
  }],
  status: 'INCLUDED' as const,
};

const serverIncident = {
  ...originalServerIncident,
  location: 'Current server location',
  description: 'Current server review incident',
};

function makeSession(incidents = [originalServerIncident], version = 1) {
  return {
    id: 'session-1',
    version,
    sourceFiles: [{
      id: 'source-1',
      source: 'Test source',
      title: 'Test report',
      url: 'https://example.com/report',
      contentDepth: 'FULL_TEXT',
      content: 'Original server review incident. Exact supporting sentence.',
    }],
    assessment: {
      selectedSourceFileIds: ['source-1'],
      countAnswer: {
        incidents,
        finalized: false,
        confidence: 'MODERATE',
        question: 'How many incidents?',
        inclusionCriteria: 'Dated and cited incidents',
        requestedParties: ['Party A'],
      },
    },
  } as never;
}

describe('CountAnswerReview conflict handling', () => {
  afterEach(cleanup);

  beforeEach(() => {
    mutate.mockReset();
    getAnalysisSession.mockReset();
  });

  it('preserves the local draft until reload is explicitly confirmed', async () => {
    const onUpdated = vi.fn();
    const currentServerSession = makeSession([serverIncident], 2);
    getAnalysisSession.mockResolvedValue(currentServerSession);
    mutate.mockImplementation((_variables, options) => {
      options.onError({ status: 409 });
    });

    render(<CountAnswerReview session={makeSession()} onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove incident from count' }));
    expect(screen.getByRole('button', { name: 'Approve incident' })).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          incidents: [expect.objectContaining({ id: 'incident-1', status: 'EXCLUDED' })],
        }),
      }),
      expect.any(Object),
    );
    expect(screen.getByTestId('notice-review-conflict')).toBeTruthy();
    expect(screen.queryByTestId('error-save-review')).toBeNull();
    expect(screen.getByRole('button', { name: 'Approve incident' })).toBeTruthy();
    expect(onUpdated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-reload-review'));

    expect(screen.getByRole('button', { name: 'Approve incident' })).toBeTruthy();
    expect(getAnalysisSession).not.toHaveBeenCalled();
    expect(onUpdated).not.toHaveBeenCalled();
    expect(screen.getByTestId('button-confirm-reload-review')).toBeTruthy();

    fireEvent.click(screen.getByTestId('button-confirm-reload-review'));

    await waitFor(() => expect(getAnalysisSession).toHaveBeenCalledWith(
      'session-1',
      { cache: 'no-store' },
    ));
    await waitFor(() => expect(screen.getByText('Current server review incident')).toBeTruthy());

    expect(screen.getByRole('button', { name: 'Remove incident from count' })).toBeTruthy();
    expect(onUpdated).toHaveBeenCalledWith(currentServerSession);
  });

  it('keeps the local draft and allows another attempt when confirmed reload fails', async () => {
    const onUpdated = vi.fn();
    const currentServerSession = makeSession([serverIncident], 2);
    getAnalysisSession
      .mockRejectedValueOnce(new Error('Server unavailable'))
      .mockResolvedValueOnce(currentServerSession);
    mutate.mockImplementation((_variables, options) => {
      options.onError({ status: 409 });
    });

    render(<CountAnswerReview session={makeSession()} onUpdated={onUpdated} />);

    fireEvent.click(screen.getByRole('button', { name: 'Remove incident from count' }));
    fireEvent.click(screen.getByRole('button', { name: 'Save review' }));
    fireEvent.click(screen.getByTestId('button-reload-review'));
    fireEvent.click(screen.getByTestId('button-confirm-reload-review'));

    await waitFor(() => expect(screen.getByTestId('error-reload-review')).toBeTruthy());
    expect(screen.getByText('Original server review incident')).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Approve incident' })).toBeTruthy();
    expect(screen.getByTestId('button-reload-review')).toBeTruthy();
    expect(onUpdated).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('button-reload-review'));
    fireEvent.click(screen.getByTestId('button-confirm-reload-review'));

    await waitFor(() => expect(getAnalysisSession).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByText('Current server review incident')).toBeTruthy());
    expect(onUpdated).toHaveBeenCalledWith(currentServerSession);
  });

  it('creates exact evidence spans for analyst-added incidents before finalizing', () => {
    render(<CountAnswerReview session={makeSession([])} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add incident' }));
    fireEvent.change(screen.getByLabelText('Incident date'), { target: { value: '2026-09-14' } });
    fireEvent.change(screen.getByPlaceholderText('Location'), { target: { value: 'Test location' } });
    fireEvent.change(screen.getByLabelText('Supporting source'), { target: { value: 'source-1' } });
    fireEvent.change(
      screen.getByPlaceholderText('Paste the supporting incident sentence from the selected source'),
      { target: { value: 'Exact supporting sentence' } },
    );
    fireEvent.click(screen.getByTestId('button-submit-incident'));
    fireEvent.click(screen.getByRole('button', { name: 'Finalize count' }));

    expect(mutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          finalized: true,
          incidents: [expect.objectContaining({
            evidenceSpans: [{
              sourceFileId: 'source-1',
              text: 'Exact supporting sentence',
              startChar: 33,
              endChar: 58,
            }],
          })],
        }),
      }),
      expect.any(Object),
    );
  });

  it('blocks analyst-added evidence that is not an exact source match', () => {
    render(<CountAnswerReview session={makeSession([])} onUpdated={vi.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'Add incident' }));
    fireEvent.change(screen.getByLabelText('Incident date'), { target: { value: '2026-09-14' } });
    fireEvent.change(screen.getByPlaceholderText('Location'), { target: { value: 'Test location' } });
    fireEvent.change(screen.getByLabelText('Supporting source'), { target: { value: 'source-1' } });
    fireEvent.change(
      screen.getByPlaceholderText('Paste the supporting incident sentence from the selected source'),
      { target: { value: 'Paraphrased evidence' } },
    );
    fireEvent.click(screen.getByTestId('button-submit-incident'));

    expect(screen.getByTestId('error-incident-evidence').textContent).toContain(
      'exact supporting sentence',
    );
    expect(mutate).not.toHaveBeenCalled();
  });
});