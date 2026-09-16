import { Clock3, FileText, Radio } from 'lucide-react';
import type { AnalysisStarters } from './starters';
import { suggestedTopics } from './starters';

export function StarterPanel({ starters, loading, onUseQuestion, onOpenSession }: {
  starters?: AnalysisStarters;
  loading: boolean;
  onUseQuestion: (question: string) => void;
  onOpenSession: (sessionId: string) => void;
}) {
  return <div className="mt-5 grid gap-4 border-t border-border/70 pt-4 lg:grid-cols-3" data-testid="panel-question-starters">
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
  </div>;
}