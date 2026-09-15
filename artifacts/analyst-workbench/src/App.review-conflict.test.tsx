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

import { CountAnswerReview } from './App';

const originalServerIncident = {
  id: 'incident-1',
  date: '2026-09-14T12:00:00.000Z',
  location: 'Original server location',
  parties: ['Party A'],
  description: 'Original server review incident',
  sourceFileIds: ['source-1'],
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
      contentDepth: 'FULL',
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
});