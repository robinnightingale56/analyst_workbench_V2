import { SlidersHorizontal } from 'lucide-react';
import type { EvaluationVectorDefinition, EvaluationVectorResult } from '@workspace/api-client-react';

export function EvaluationVectorOverview({ vectors, results, loading }: {
  vectors?: EvaluationVectorDefinition[];
  results?: EvaluationVectorResult[];
  loading: boolean;
}) {
  const byId = new Map(results?.map((result) => [result.id, result]) ?? []);
  return <section className="border border-card-border bg-card p-5 md:p-6" data-testid="panel-evaluation-vectors">
    <div className="flex items-start gap-3"><span className="grid h-8 w-8 place-items-center bg-[hsl(174_44%_43%_/_0.12)] text-[hsl(174_44%_32%)]"><SlidersHorizontal size={16} /></span><div><div className="section-kicker">Evaluation vectors</div><h2 className="mt-1 text-lg font-bold">Review lenses, before collection</h2><p className="mt-1 max-w-3xl text-xs leading-5 text-muted-foreground">These are placeholder metadata heuristics, not ICD-203 standards or content-grounded ratings. They remain provisional until an analyst evaluates report content.</p></div></div>
    {loading ? <div className="mt-4 grid gap-2 md:grid-cols-3"><div className="h-20 animate-pulse bg-muted" /><div className="h-20 animate-pulse bg-muted" /><div className="h-20 animate-pulse bg-muted" /></div> : <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-3">{vectors?.map((vector) => { const result = byId.get(vector.id); return <article className="border border-border/75 bg-muted/20 p-3" key={vector.id}><div className="flex items-start justify-between gap-2"><div className="text-sm font-semibold">{vector.name}</div>{result ? <span className="mono text-xs font-bold">{result.score}/100</span> : <span className="mono text-[9px] text-muted-foreground">NOT SCORED</span>}</div><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{vector.description}</p>{result ? <><p className="mt-2 text-[11px] leading-4 text-muted-foreground">{result.rationale}</p><p className="mt-1 text-[10px] text-muted-foreground">References {result.evidenceSourceFileIds.length} selected source{result.evidenceSourceFileIds.length === 1 ? '' : 's'}; content has not been evaluated against this vector.</p></> : null}<div className="mono mt-2 text-[9px] uppercase tracking-[0.08em] text-[hsl(30_69%_32%)]">Placeholder · {Math.round(vector.weight * 100)}% weight{result ? ` · ${result.status}` : ''}</div></article>; })}</div>}
  </section>;
}