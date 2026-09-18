import { CircleAlert, Clock3, ExternalLink, FileText, LockKeyhole, Radio, RefreshCw } from 'lucide-react';
import type { CurrentEventFeed } from '@workspace/api-client-react';
export type { CurrentEventFeed } from '@workspace/api-client-react';
import type { AnalysisStarters } from './starters';
import { suggestedTopics } from './starters';

function formatEventDate(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function providerStatusClass(status: string) {
  if (status === 'OK') return 'border-[hsl(174_44%_43%_/_0.35)] bg-[hsl(174_44%_43%_/_0.08)] text-[hsl(174_44%_32%)]';
  if (status === 'BLOCKED') return 'border-[hsl(39_92%_65%_/_0.5)] bg-[hsl(39_92%_65%_/_0.1)] text-[hsl(30_69%_32%)]';
  return 'border-[hsl(5_69%_48%_/_0.3)] bg-[hsl(5_69%_48%_/_0.06)] text-[hsl(5_69%_40%)]';
}

export function StarterPanel({
  starters,
  loading,
  onUseQuestion,
  onOpenSession,
  currentEvents,
  currentEventsLoading = false,
  currentEventsError = false,
  currentEventsRestricted = false,
  currentEventsRefreshing = false,
  onRefreshCurrentEvents,
}: {
  starters?: AnalysisStarters;
  loading: boolean;
  onUseQuestion: (question: string) => void;
  onOpenSession: (sessionId: string) => void;
  currentEvents?: CurrentEventFeed;
  currentEventsLoading?: boolean;
  currentEventsError?: boolean;
  currentEventsRestricted?: boolean;
  currentEventsRefreshing?: boolean;
  onRefreshCurrentEvents?: () => void;
}) {
  return <div className="mt-5 grid gap-4 border-t border-border/70 pt-4 lg:grid-cols-4" data-testid="panel-question-starters">
    <div>
      <div className="section-kicker">Suggested topics</div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Editable question starters, not current reporting.</p>
      <div className="mt-2 space-y-2">{suggestedTopics.map((topic) => <button type="button" onClick={() => onUseQuestion(topic)} className="block w-full border border-border bg-muted/25 p-2 text-left text-xs hover:border-primary" key={topic} data-testid="button-suggested-topic">{topic}</button>)}</div>
    </div>
    <div>
      <div className="section-kicker">Your recent questions</div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Open resumes the saved session; Use as new makes an editable new question.</p>
      <div className="mt-2 space-y-2">{loading ? <div className="h-14 animate-pulse bg-muted" /> : starters?.recentQuestions.length ? starters.recentQuestions.slice(0, 3).map((question) => <div className="border border-border bg-card p-2" key={question.sessionId}><p className="line-clamp-2 text-xs">{question.prompt}</p><div className="mt-2 flex gap-3 text-[11px] font-semibold text-[hsl(174_44%_32%)]"><button onClick={() => onOpenSession(question.sessionId)} data-testid={`button-resume-session-${question.sessionId}`}>Resume</button><button onClick={() => onUseQuestion(question.prompt)} data-testid={`button-use-question-${question.sessionId}`}>Use as new</button></div></div>) : <p className="border border-dashed border-border p-3 text-xs text-muted-foreground">No prior questions in your workspace.</p>}</div>
    </div>
    <div>
      <div className="section-kicker">Leads from your prior research</div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Dated public-source results from your own prior research. This is not an ongoing or current-events feed.</p>
      <div className="mt-2 space-y-2">{loading ? <div className="h-14 animate-pulse bg-muted" /> : starters?.ongoingEvents.length ? starters.ongoingEvents.slice(0, 3).map((event) => <div className="border border-border bg-card p-2" key={`${event.sessionId}-${event.sourceUrl}`}><p className="line-clamp-2 text-xs font-semibold">{event.title}</p><p className="mt-1 text-[10px] text-muted-foreground"><Radio size={10} className="mr-1 inline" />Published {event.publishedAt} · retrieved {event.retrievedAt}</p><a href={event.sourceUrl} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[10px] font-semibold text-[hsl(174_44%_32%)]"><FileText size={10} />{event.sourceTitle}</a><button onClick={() => onUseQuestion(event.question)} className="mt-2 block text-[11px] font-semibold text-[hsl(174_44%_32%)]" data-testid={`button-use-event-${event.sessionId}`}>Use as new question</button></div>) : <p className="border border-dashed border-border p-3 text-xs text-muted-foreground"><Clock3 size={12} className="mr-1 inline" />No dated source results are available from your prior research.</p>}</div>
    </div>
    <div className="min-w-0" data-testid="panel-current-events">
      <div className="flex items-start justify-between gap-2">
        <div className="section-kicker">Current events</div>
        <button
          type="button"
          onClick={onRefreshCurrentEvents}
          disabled={currentEventsRestricted || currentEventsLoading || currentEventsRefreshing || !onRefreshCurrentEvents}
          className="inline-flex items-center gap-1 text-[10px] font-semibold text-[hsl(174_44%_32%)] disabled:cursor-not-allowed disabled:opacity-40"
          data-testid="button-refresh-current-events"
          aria-label="Refresh current events"
        >
          <RefreshCw size={11} className={currentEventsRefreshing ? 'animate-spin' : ''} />
          Refresh
        </button>
      </div>
      <p className="mt-1 text-[11px] leading-4 text-muted-foreground">Fresh provider reporting for starting a new research question. These results are not saved to a session.</p>
      {currentEventsRestricted ? (
        <div className="mt-2 flex items-start gap-2 border border-[hsl(39_92%_65%_/_0.5)] bg-[hsl(39_92%_65%_/_0.1)] p-3 text-[11px] leading-4 text-muted-foreground" data-testid="state-current-events-restricted">
          <LockKeyhole size={13} className="mt-0.5 shrink-0 text-[hsl(30_69%_32%)]" />
          <span>Current public events are unavailable for this classification. Any previously cached public results are hidden.</span>
        </div>
      ) : currentEventsLoading ? (
        <div className="mt-2 space-y-2" data-testid="state-current-events-loading">
          <div className="h-20 animate-pulse bg-muted" />
          <div className="h-20 animate-pulse bg-muted" />
        </div>
      ) : currentEventsError ? (
        <div className="mt-2 flex items-start gap-2 border border-[hsl(5_69%_48%_/_0.3)] bg-[hsl(5_69%_48%_/_0.06)] p-3 text-[11px] leading-4 text-muted-foreground" data-testid="state-current-events-error">
          <CircleAlert size={13} className="mt-0.5 shrink-0 text-[hsl(5_69%_40%)]" />
          <span>Current events could not be requested. Refresh to try again.</span>
        </div>
      ) : currentEvents?.blocked ? (
        <div className="mt-2 flex items-start gap-2 border border-[hsl(39_92%_65%_/_0.5)] bg-[hsl(39_92%_65%_/_0.1)] p-3 text-[11px] leading-4 text-muted-foreground" data-testid="state-current-events-blocked">
          <LockKeyhole size={13} className="mt-0.5 shrink-0 text-[hsl(30_69%_32%)]" />
          <span>Public current-event discovery is blocked by provider policy. No headlines are shown.</span>
        </div>
      ) : currentEvents?.events.length ? (
        <div className="mt-2 space-y-2" data-testid="state-current-events-results">
          {currentEvents.events.map((event) => (
            <article className="border border-border bg-card p-2" key={event.id} data-testid={`card-current-event-${event.id}`}>
              <div className="flex items-start justify-between gap-2">
                <p className="line-clamp-3 text-xs font-semibold">{event.title}</p>
                <span className="shrink-0 border border-[hsl(174_44%_43%_/_0.35)] bg-[hsl(174_44%_43%_/_0.08)] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-[hsl(174_44%_32%)]">{event.freshness}</span>
              </div>
              <p className="mt-1 text-[10px] text-muted-foreground">Provider {event.provider}</p>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">
                Published <time dateTime={event.publishedAt}>{formatEventDate(event.publishedAt)}</time>
                {' · '}retrieved <time dateTime={event.retrievedAt}>{formatEventDate(event.retrievedAt)}</time>
              </p>
              <a href={event.url} target="_blank" rel="noreferrer" className="mt-1 inline-flex max-w-full items-center gap-1 truncate text-[10px] font-semibold text-[hsl(174_44%_32%)] hover:underline" data-testid={`link-current-event-${event.id}`}>
                <ExternalLink size={10} className="shrink-0" />{event.url}
              </a>
              <button type="button" onClick={() => onUseQuestion(event.question)} className="mt-2 block text-[11px] font-semibold text-[hsl(174_44%_32%)]" data-testid={`button-use-current-event-${event.id}`}>Use as new question</button>
            </article>
          ))}
        </div>
      ) : (
        <div className="mt-2 border border-dashed border-border p-3 text-[11px] leading-4 text-muted-foreground" data-testid="state-current-events-empty">
          No current events were returned by the configured providers.
        </div>
      )}
      {!currentEventsRestricted && currentEvents ? (
        <p className="border-t border-border/70 pt-2 text-[10px] leading-4 text-muted-foreground" data-testid="current-events-feed-metadata">
          Feed checked <time dateTime={currentEvents.checkedAt}>{formatEventDate(currentEvents.checkedAt)}</time>
          {' · '}freshness window {currentEvents.freshnessWindowHours} hours
        </p>
      ) : null}
      {!currentEventsRestricted && currentEvents?.providers.length ? (
        <div className="mt-3 space-y-1.5" data-testid="current-events-provider-status">
          <div className="mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Provider status</div>
          {currentEvents.providers.map((provider) => (
            <div className={`border p-2 text-[10px] ${providerStatusClass(provider.status)}`} key={provider.provider} data-testid={`current-event-provider-${provider.provider}`}>
              <div className="flex items-center justify-between gap-2 font-semibold">
                <span>{provider.provider}</span>
                <span>{provider.status}</span>
              </div>
              <p className="mt-0.5 leading-4">{provider.message}</p>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  </div>;
}