import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import type { ComponentProps } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StarterPanel, type CurrentEventFeed } from './StarterPanel';

const feed: CurrentEventFeed = {
  events: [{
    id: 'event-1',
    title: 'A verified current headline',
    question: 'What should an analyst monitor next?',
    url: 'https://provider.example.test/story/event-1',
    provider: 'Provider One',
    publishedAt: '2026-09-14T08:00:00Z',
    retrievedAt: '2026-09-14T09:00:00Z',
    freshness: 'CURRENT',
  }],
  providers: [
    { provider: 'Provider One', status: 'OK', message: 'Available' },
    { provider: 'Provider Two', status: 'ERROR', message: 'Request timed out' },
  ],
  checkedAt: '2026-09-14T09:05:00Z',
  freshnessWindowHours: 24,
  blocked: false,
};

function renderPanel(props: Partial<ComponentProps<typeof StarterPanel>> = {}) {
  return render(
    <StarterPanel
      loading={false}
      onUseQuestion={vi.fn()}
      onOpenSession={vi.fn()}
      currentEvents={feed}
      {...props}
    />,
  );
}

describe('StarterPanel current events', () => {
  afterEach(cleanup);

  it('shows actual event metadata, URL, feed check, freshness window, and provider status', () => {
    renderPanel();

    expect(screen.getByText('A verified current headline')).toBeTruthy();
    expect(screen.getByTestId('link-current-event-event-1').getAttribute('href')).toBe('https://provider.example.test/story/event-1');
    expect(screen.getByText(/Published/)).toBeTruthy();
    expect(screen.getByText(/retrieved/)).toBeTruthy();
    expect(screen.getByTestId('current-events-feed-metadata').textContent).toContain('24 hours');
    expect(screen.getByTestId('current-event-provider-Provider One').textContent).toContain('Available');
    expect(screen.getByTestId('current-event-provider-Provider Two').textContent).toContain('Request timed out');
  });

  it('supports a manual refresh action', () => {
    const onRefresh = vi.fn();
    renderPanel({ onRefreshCurrentEvents: onRefresh });

    fireEvent.click(screen.getByTestId('button-refresh-current-events'));
    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('renders loading, empty, request-error, and restricted states without headlines', () => {
    const { rerender } = renderPanel({ currentEventsLoading: true });
    expect(screen.getByTestId('state-current-events-loading')).toBeTruthy();

    rerender(<StarterPanel loading={false} onUseQuestion={vi.fn()} onOpenSession={vi.fn()} currentEvents={{ ...feed, events: [] }} />);
    expect(screen.getByTestId('state-current-events-empty')).toBeTruthy();
    expect(screen.queryByText('A verified current headline')).toBeNull();

    rerender(<StarterPanel loading={false} onUseQuestion={vi.fn()} onOpenSession={vi.fn()} currentEventsError />);
    expect(screen.getByTestId('state-current-events-error')).toBeTruthy();

    rerender(<StarterPanel loading={false} onUseQuestion={vi.fn()} onOpenSession={vi.fn()} currentEvents={feed} currentEventsRestricted />);
    expect(screen.getByTestId('state-current-events-restricted')).toBeTruthy();
    expect(screen.queryByText('A verified current headline')).toBeNull();
    expect(screen.queryByTestId('link-current-event-event-1')).toBeNull();
  });
});