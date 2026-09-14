import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  Check,
  ChevronRight,
  CircleAlert,
  ClipboardCheck,
  Clock3,
  Database,
  FileText,
  Gauge,
  Layers3,
  Loader2,
  LockKeyhole,
  Menu,
  Network,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  X,
  Zap,
} from 'lucide-react';
import {
  AnalysisSessionClassification,
  AnalyticStandardStatus,
  SourceConnectorStatus,
  useCreateAnalysisSession,
  useCreateAssessment,
  useGetAnalysisSession,
  useHealthCheck,
  useListAnalysisSessions,
  useListSourceConnectors,
  useRunResearch,
  getGetAnalysisSessionQueryKey,
  type AnalysisSession,
  type AnalyticStandard,
  type SourceConnector,
  type SourceFile,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();

const navItems = [
  { href: '/', label: 'Workbench', icon: Target },
  { href: '/sessions', label: 'Sessions', icon: Layers3 },
  { href: '/standards', label: 'ICD-203 standards', icon: BookOpen },
  { href: '/settings', label: 'Settings', icon: Settings2 },
];

const standards: AnalyticStandard[] = [
  { id: 's1', name: 'Properly describes the issue', shortName: 'Issue', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Frame the question with a clear decision point and scope.', prompt: 'Does the assessment directly answer the stated intelligence question?' },
  { id: 's2', name: 'Makes accurate judgments', shortName: 'Accuracy', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Separate what the sources show from what the analyst infers.', prompt: 'Are judgments traceable to the available evidence?' },
  { id: 's3', name: 'Expresses uncertainty', shortName: 'Uncertainty', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Name confidence and the conditions that could change the judgment.', prompt: 'Is uncertainty explicit rather than implied?' },
  { id: 's4', name: 'Distinguishes evidence', shortName: 'Evidence', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Keep sourced facts distinct from assumptions and analytic claims.', prompt: 'Can a reviewer tell evidence from interpretation?' },
  { id: 's5', name: 'Explains analytic logic', shortName: 'Logic', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Show the reasoning chain from source observation to judgment.', prompt: 'Would another analyst be able to reproduce the reasoning?' },
  { id: 's6', name: 'Identifies assumptions', shortName: 'Assumptions', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Surface assumptions that materially affect the conclusion.', prompt: 'Are key assumptions and dependencies visible?' },
  { id: 's7', name: 'Uses source quality', shortName: 'Source quality', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Calibrate confidence to source reliability, relevance, and currency.', prompt: 'Does source quality appropriately shape the assessment?' },
  { id: 's8', name: 'Considers alternatives', shortName: 'Alternatives', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Test the leading judgment against credible competing explanations.', prompt: 'Are plausible alternatives considered and bounded?' },
  { id: 's9', name: 'States implications', shortName: 'Implications', score: 0, status: AnalyticStandardStatus.REVIEW, finding: 'Connect the judgment to what a decision-maker should watch or do next.', prompt: 'Are implications specific enough to guide collection or action?' },
];

function formatDate(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' }).format(date);
}

function formatDateTime(value?: string) {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }).format(date);
}

function statusTone(status?: string) {
  if (status === 'COMPLETE' || status === 'READY' || status === 'PASS') return 'bg-[hsl(174_44%_43%_/_0.13)] text-[hsl(174_44%_32%)] border-[hsl(174_44%_43%_/_0.3)]';
  if (status === 'RESEARCHING' || status === 'ASSESSING' || status === 'REVIEW') return 'bg-[hsl(39_92%_65%_/_0.18)] text-[hsl(30_69%_32%)] border-[hsl(39_92%_65%_/_0.45)]';
  if (status === 'GAP' || status === 'NEEDS_CONFIGURATION') return 'bg-[hsl(5_69%_48%_/_0.1)] text-[hsl(5_69%_40%)] border-[hsl(5_69%_48%_/_0.25)]';
  return 'bg-[hsl(216_22%_93%)] text-[hsl(218_13%_46%)] border-[hsl(220_18%_86%)]';
}

function StatusPill({ status }: { status?: string }) {
  return <span className={`inline-flex items-center gap-1.5 border px-2 py-1 text-[10px] font-semibold tracking-[0.08em] ${statusTone(status)}`} data-testid={`status-${status?.toLowerCase()}`}>{status?.replaceAll('_', ' ') ?? 'UNKNOWN'}</span>;
}

function LoadingRows({ count = 3 }: { count?: number }) {
  return <div className="space-y-3" data-testid="loading-state">{Array.from({ length: count }).map((_, index) => <div className="h-16 animate-pulse border border-border/70 bg-card/70" key={index} />)}</div>;
}

function EmptyState({ icon: Icon, title, detail, action }: { icon: typeof FileText; title: string; detail: string; action?: ReactNode }) {
  return <div className="flex flex-col items-center justify-center border border-dashed border-border bg-card/65 px-6 py-16 text-center" data-testid="empty-state">
    <div className="mb-4 grid h-11 w-11 place-items-center border border-border bg-muted text-muted-foreground"><Icon size={19} /></div>
    <h3 className="display text-lg font-semibold text-foreground">{title}</h3>
    <p className="mt-2 max-w-sm text-sm leading-6 text-muted-foreground">{detail}</p>
    {action ? <div className="mt-5">{action}</div> : null}
  </div>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const activePath = location.split('?')[0];
  return <div className="workbench-shell min-h-[100dvh] text-foreground">
    <aside className={`${mobileOpen ? 'translate-x-0' : '-translate-x-full'} fixed inset-y-0 left-0 z-30 flex w-[250px] flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground transition-transform duration-200 md:translate-x-0`} data-testid="sidebar">
      <div className="flex h-[72px] items-center gap-3 border-b border-sidebar-border px-5">
        <div className="grid h-8 w-8 place-items-center bg-sidebar-primary text-sidebar-primary-foreground"><Gauge size={17} strokeWidth={2.5} /></div>
        <div><div className="display text-[15px] font-bold tracking-tight text-white">Analyst Workbench</div><div className="mono mt-0.5 text-[9px] uppercase tracking-[0.18em] text-sidebar-foreground/60">Assessment cell / 01</div></div>
      </div>
      <div className="px-4 pt-6">
        <div className="section-kicker mb-3 px-2 text-sidebar-foreground/45">Workspace</div>
        <nav className="space-y-1">
          {navItems.map(({ href, label, icon: Icon }) => <Link href={href} key={href} onClick={() => setMobileOpen(false)} className={`group flex items-center gap-3 border-l-2 px-3 py-2.5 text-sm transition-colors ${activePath === href ? 'border-sidebar-primary bg-sidebar-accent text-white' : 'border-transparent text-sidebar-foreground/70 hover:bg-sidebar-accent/70 hover:text-white'}`} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`}>
            <Icon size={16} className={activePath === href ? 'text-sidebar-primary' : 'text-sidebar-foreground/50 group-hover:text-sidebar-primary'} /><span>{label}</span>{activePath === href ? <ChevronRight size={14} className="ml-auto text-sidebar-primary" /> : null}
          </Link>)}
        </nav>
      </div>
      <div className="mt-auto px-4 pb-5">
        <div className="mb-4 border border-sidebar-border bg-sidebar-accent/50 p-3">
          <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 bg-[hsl(174_55%_55%)]" /><span className="mono text-[10px] uppercase tracking-[0.14em] text-sidebar-foreground/80">Environment nominal</span></div>
          <p className="mt-2 text-xs leading-5 text-sidebar-foreground/55">Classification controls are enforced per session.</p>
        </div>
        <div className="flex items-center gap-3 border-t border-sidebar-border pt-4"><div className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(39_92%_65%_/_0.2)] mono text-xs font-medium text-sidebar-primary">AR</div><div><div className="text-xs font-semibold text-white">A. Reyes</div><div className="mono text-[10px] text-sidebar-foreground/50">All-source analyst</div></div><button onClick={() => setLocation('/settings')} className="ml-auto text-sidebar-foreground/50 hover:text-white" data-testid="button-profile-settings" aria-label="Open settings"><Settings2 size={15} /></button></div>
      </div>
    </aside>
    {mobileOpen ? <button className="fixed inset-0 z-20 bg-[hsl(222_38%_15%_/_0.48)] md:hidden" onClick={() => setMobileOpen(false)} aria-label="Close navigation" data-testid="button-close-navigation" /> : null}
    <main className="min-h-[100dvh] md:pl-[250px]">
      <header className="sticky top-0 z-10 flex h-[72px] items-center justify-between border-b border-border/75 bg-[hsl(222_24%_96%_/_0.88)] px-5 backdrop-blur md:px-8">
        <div className="flex items-center gap-3"><button className="text-muted-foreground md:hidden" onClick={() => setMobileOpen(true)} data-testid="button-open-navigation" aria-label="Open navigation"><Menu size={20} /></button><div className="hidden items-center gap-2 text-xs text-muted-foreground sm:flex"><span className="mono">OPS</span><ChevronRight size={13} /><span className="text-foreground">Intelligence production</span></div></div>
        <div className="flex items-center gap-4"><div className="hidden items-center gap-2 border-r border-border pr-4 text-xs text-muted-foreground sm:flex"><span className="h-1.5 w-1.5 bg-[hsl(174_44%_43%)]" />Systems nominal</div><div className="mono text-[10px] tracking-[0.12em] text-muted-foreground">UNCLASSIFIED / INTERNAL</div></div>
      </header>
      <div className="mx-auto max-w-[1480px] px-5 py-7 md:px-8 md:py-9">{children}</div>
    </main>
  </div>;
}

function ConnectorPicker({ connectors, selected, setSelected, loading, error }: { connectors?: SourceConnector[]; selected: string[]; setSelected: (ids: string[]) => void; loading: boolean; error: boolean }) {
  if (loading) return <div className="grid gap-2 md:grid-cols-2"><div className="h-[72px] animate-pulse bg-muted" /><div className="h-[72px] animate-pulse bg-muted" /></div>;
  if (error) return <div className="flex items-start gap-3 border border-[hsl(5_69%_48%_/_0.25)] bg-[hsl(5_69%_48%_/_0.06)] p-4 text-sm" data-testid="error-connectors"><CircleAlert size={17} className="mt-0.5 text-[hsl(5_69%_48%)]" /><div><div className="font-semibold text-foreground">Connector registry unavailable</div><p className="mt-1 text-muted-foreground">Research cannot be run until source readiness can be verified.</p></div></div>;
  if (!connectors?.length) return <EmptyState icon={Network} title="No source adapters configured" detail="Ask a workspace administrator to configure at least one connector before running research." />;
  return <div className="grid gap-2 md:grid-cols-2" data-testid="connector-list">{connectors.map((connector) => {
    const ready = connector.status === SourceConnectorStatus.READY;
    const active = selected.includes(connector.id);
    return <button type="button" disabled={!ready} key={connector.id} onClick={() => setSelected(active ? selected.filter((id) => id !== connector.id) : [...selected, connector.id])} className={`flex items-start gap-3 border p-3 text-left transition-all ${active ? 'border-[hsl(39_92%_65%)] bg-[hsl(39_92%_65%_/_0.1)]' : 'border-border bg-card hover:border-[hsl(39_92%_65%_/_0.65)]'} ${!ready ? 'cursor-not-allowed opacity-55' : ''}`} data-testid={`button-connector-${connector.id}`}>
      <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'}`}>{active ? <Check size={11} /> : null}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground">{connector.name}</span><StatusPill status={connector.status} /></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{connector.description}</span><span className="mono mt-2 block text-[9px] uppercase tracking-[0.08em] text-muted-foreground/80">{connector.sourceTypes.join(' / ')}</span></span>
    </button>;
  })}</div>;
}

function SourceCard({ source, selected, onToggle }: { source: SourceFile; selected: boolean; onToggle: () => void }) {
  return <article className={`relative border bg-card p-5 transition-all ${selected ? 'border-[hsl(39_92%_65%)] shadow-[inset_3px_0_0_hsl(39_92%_65%)]' : 'border-card-border hover:border-[hsl(220_18%_74%)]'}`} data-testid={`card-source-${source.id}`}>
    <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center bg-secondary text-secondary-foreground"><FileText size={14} /></span><div className="min-w-0"><div className="mono truncate text-[10px] uppercase tracking-[0.09em] text-muted-foreground">{source.source} / {source.sourceType}</div><h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-foreground">{source.title}</h3></div></div><button type="button" onClick={onToggle} className={`grid h-7 w-7 shrink-0 place-items-center border transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary hover:text-primary'}`} aria-label={selected ? 'Remove source from assessment' : 'Select source for assessment'} data-testid={`button-select-source-${source.id}`}>{selected ? <Check size={14} /> : <Plus size={15} />}</button></div>
    <div className="mt-4 border-l-2 border-[hsl(39_92%_65%_/_0.7)] pl-3 text-[13px] leading-5 text-foreground/85"><span className="mono mr-2 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">BLUF</span>{source.bluf}</div>
    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-3"><div><div className="mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Relevance</div><div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 bg-secondary"><div className="h-full bg-[hsl(174_44%_43%)]" style={{ width: `${Math.round(source.relevance * 100)}%` }} /></div><span className="mono text-[10px] font-medium">{Math.round(source.relevance * 100)}%</span></div></div><div><div className="mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Reliability</div><div className="mt-1"><StatusPill status={source.reliability} /></div></div></div>
    <div className="mt-4 flex flex-wrap gap-1.5">{source.tags.map((tag) => <span className="mono border border-border bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground" key={tag}>{tag}</span>)}</div>
    <a className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[hsl(174_44%_32%)] hover:underline" href={source.url} target="_blank" rel="noreferrer" data-testid={`link-source-${source.id}`}>Open source <ArrowUpRight size={12} /></a>
  </article>;
}

function Home() {
  const [location, setLocation] = useLocation();
  const querySessionId = new URLSearchParams(location.split('?')[1] ?? '').get('session');
  const [prompt, setPrompt] = useState('');
  const [classification, setClassification] = useState<keyof typeof AnalysisSessionClassification>('UNCLASSIFIED');
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(querySessionId ?? '');
  const [createdSession, setCreatedSession] = useState<AnalysisSession | null>(null);
  const [researchResult, setResearchResult] = useState<AnalysisSession | null>(null);
  const [actionError, setActionError] = useState('');

  useEffect(() => { if (querySessionId && querySessionId !== activeSessionId) setActiveSessionId(querySessionId); }, [querySessionId, activeSessionId]);
  const connectorsQuery = useListSourceConnectors();
  const sessionQuery = useGetAnalysisSession(activeSessionId, { query: { enabled: Boolean(activeSessionId), queryKey: getGetAnalysisSessionQueryKey(activeSessionId) } });
  const createSession = useCreateAnalysisSession();
  const runResearch = useRunResearch();
  const createAssessment = useCreateAssessment();
  const session = researchResult ?? sessionQuery.data ?? createdSession;
  const sources = session?.sourceFiles ?? [];
  const canResearch = Boolean(session?.id && selectedConnectors.length && !runResearch.isPending);

  useEffect(() => {
    if (session?.sourceFiles?.length && selectedSources.length === 0) setSelectedSources(session.sourceFiles.slice(0, 2).map((source) => source.id));
  }, [session?.id, session?.sourceFiles, selectedSources.length]);

  const startSession = () => {
    setActionError('');
    if (prompt.trim().length < 5) { setActionError('Enter a research question with at least five characters.'); return; }
    createSession.mutate({ data: { prompt: prompt.trim(), analyst: 'A. Reyes', classification: AnalysisSessionClassification[classification] } }, {
      onSuccess: (nextSession) => { setCreatedSession(nextSession); setActiveSessionId(nextSession.id); setResearchResult(null); setLocation(`/?session=${nextSession.id}`); },
      onError: () => setActionError('The session could not be created. Check the API status and try again.'),
    });
  };
  const executeResearch = () => {
    if (!session?.id) { setActionError('Create the analysis session before running research.'); return; }
    if (!selectedConnectors.length) { setActionError('Select at least one ready source adapter.'); return; }
    setActionError('');
    runResearch.mutate({ sessionId: session.id, data: { sourceConnectorIds: selectedConnectors, maxResults: 12 } }, {
      onSuccess: (result) => { setResearchResult(result); setSelectedSources([]); },
      onError: () => setActionError('Research did not complete. No source-backed results were added to this workspace.'),
    });
  };
  const beginAssessment = () => {
    if (!session?.id || selectedSources.length === 0) { setActionError('Select one or more source files to begin assessment.'); return; }
    setActionError('');
    createAssessment.mutate({ sessionId: session.id, data: { selectedSourceFileIds: selectedSources } }, {
      onSuccess: (result) => setResearchResult(result),
      onError: () => setActionError('Assessment could not be started. Your source selection is unchanged.'),
    });
  };
  const isBusy = createSession.isPending || runResearch.isPending || createAssessment.isPending;
  return <div className="space-y-8">
    <div className="rise flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="section-kicker">Active production cell / {session ? `Session ${session.id.slice(0, 8)}` : 'New session'}</div><h1 className="display mt-2 max-w-3xl text-3xl font-bold tracking-[-0.03em] text-foreground md:text-[40px]">Turn a research question into a defensible assessment.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Build provenance into the workflow. Every judgment starts with a bounded question, a declared source posture, and visible uncertainty.</p></div><div className="flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs text-muted-foreground"><ShieldCheck size={15} className="text-[hsl(174_44%_43%)]" /><span>ICD-203 aligned workflow</span></div></div>
    <section className="scanline panel-shadow border border-card-border bg-card" data-testid="panel-research-question">
      <div className="flex items-center justify-between border-b border-border/75 px-5 py-4 md:px-6"><div className="flex items-center gap-3"><span className="mono grid h-6 w-6 place-items-center bg-primary text-[10px] text-primary-foreground">01</span><div><div className="text-sm font-semibold">Frame the question</div><div className="text-xs text-muted-foreground">Define the decision space before you collect.</div></div></div><StatusPill status={session?.status ?? 'DRAFT'} /></div>
      <div className="grid gap-6 p-5 md:p-6 lg:grid-cols-[1.25fr_0.75fr]"><div><label htmlFor="research-prompt" className="section-kicker">Intelligence question</label><textarea id="research-prompt" rows={4} value={prompt || session?.prompt || ''} onChange={(event) => setPrompt(event.target.value)} placeholder="What do you need to know, and by when?" className="mt-2 w-full resize-none border border-input bg-background px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground/70 focus:border-primary" data-testid="input-research-prompt" /><div className="mt-3 flex flex-wrap items-center gap-3"><label className="mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground" htmlFor="classification">Classification</label><select id="classification" value={classification} onChange={(event) => setClassification(event.target.value as keyof typeof AnalysisSessionClassification)} className="border border-input bg-background px-2.5 py-1.5 text-xs text-foreground" data-testid="select-classification">{Object.values(AnalysisSessionClassification).map((value) => <option key={value} value={value}>{value}</option>)}</select><span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><LockKeyhole size={12} /> Applied to the session record</span></div><button onClick={startSession} disabled={isBusy} className="mt-5 inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-create-session">{createSession.isPending ? <Loader2 size={15} className="animate-spin" /> : <Plus size={15} />}{session ? 'Reset with new question' : 'Create analysis session'}</button></div><div className="border-l border-border/70 pl-0 lg:pl-6"><div className="section-kicker">Source posture</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Only adapters marked ready can be selected. Unavailable sources remain visible as a readiness signal.</p><div className="mt-4"><ConnectorPicker connectors={connectorsQuery.data} selected={selectedConnectors} setSelected={setSelectedConnectors} loading={connectorsQuery.isLoading} error={Boolean(connectorsQuery.error)} /></div></div></div>
      {actionError ? <div className="flex items-center gap-2 border-t border-[hsl(5_69%_48%_/_0.22)] bg-[hsl(5_69%_48%_/_0.05)] px-5 py-3 text-xs text-[hsl(5_69%_40%)]" data-testid="error-workbench-action"><CircleAlert size={14} />{actionError}<button className="ml-auto" onClick={() => setActionError('')} aria-label="Dismiss error" data-testid="button-dismiss-error"><X size={14} /></button></div> : null}
    </section>
    <section className="rise rise-delay-1" data-testid="panel-research-results"><div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end"><div><div className="section-kicker">02 / Source review</div><h2 className="display mt-1 text-2xl font-bold tracking-tight">BLUF evidence board</h2></div><div className="flex items-center gap-3 text-xs text-muted-foreground"><span className="mono">{selectedSources.length} selected</span>{session?.status === 'READY_FOR_SELECTION' ? <button onClick={beginAssessment} disabled={createAssessment.isPending || !selectedSources.length} className="inline-flex items-center gap-2 bg-[hsl(174_44%_32%)] px-3 py-2 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45" data-testid="button-start-assessment">{createAssessment.isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}Start assessment</button> : null}</div></div>{sessionQuery.isLoading && activeSessionId ? <LoadingRows count={2} /> : sources.length ? <div className="grid gap-4 xl:grid-cols-2">{sources.map((source) => <SourceCard key={source.id} source={source} selected={selectedSources.includes(source.id)} onToggle={() => setSelectedSources((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} />)}</div> : <EmptyState icon={Radio} title="No source-backed findings yet" detail={session ? 'Run research with one or more ready adapters. Results will appear here with BLUF summaries, provenance, and reliability signals.' : 'Create an analysis session to unlock the evidence board.'} action={!session ? <button onClick={() => document.getElementById('research-prompt')?.focus()} className="inline-flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-semibold hover:border-primary" data-testid="button-focus-question"><Target size={14} />Focus the question</button> : undefined} />}</section>
    {session?.assessment ? <AssessmentSummary assessment={session.assessment} /> : null}
  </div>;
}

function AssessmentSummary({ assessment }: { assessment: NonNullable<AnalysisSession['assessment']> }) {
  return <section className="rise border border-[hsl(174_44%_43%_/_0.35)] bg-[hsl(174_44%_43%_/_0.06)] p-5 md:p-6" data-testid="panel-assessment-summary"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start"><div><div className="section-kicker text-[hsl(174_44%_32%)]">Assessment complete</div><h2 className="display mt-1 text-2xl font-bold">A defensible judgment, ready for review.</h2></div><div className="flex items-end gap-2"><span className="display text-4xl font-bold text-[hsl(174_44%_32%)]">{assessment.overallScore}</span><span className="mono mb-1 text-[10px] uppercase text-muted-foreground">/ 100</span></div></div><p className="mt-4 max-w-3xl text-sm leading-6 text-foreground/80">{assessment.summary}</p><div className="mt-5 grid gap-2 sm:grid-cols-3 lg:grid-cols-5">{assessment.standards.map((standard) => <div className="border border-border/70 bg-card/70 p-3" key={standard.id}><div className="flex items-center justify-between"><span className="mono text-[10px] font-medium">{standard.shortName}</span><span className="text-sm font-bold">{standard.score}</span></div><div className="mt-2 h-1 bg-secondary"><div className="h-full bg-[hsl(174_44%_43%)]" style={{ width: `${standard.score}%` }} /></div><div className="mt-2"><StatusPill status={standard.status} /></div></div>)}</div></section>;
}

function SessionsPage() {
  const sessionsQuery = useListAnalysisSessions();
  const [, setLocation] = useLocation();
  return <div className="space-y-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="section-kicker">Production history</div><h1 className="display mt-2 text-3xl font-bold tracking-tight">Recent sessions</h1><p className="mt-2 text-sm text-muted-foreground">Every question, source run, and assessment stays attributable to its originating session.</p></div><Link href="/" className="inline-flex items-center gap-2 self-start bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="link-new-session"><Plus size={15} /> New session</Link></div><div className="flex flex-wrap items-center gap-2 border-y border-border/70 py-3 text-xs text-muted-foreground"><Search size={14} /><span>Showing latest workspace activity</span><span className="ml-auto mono">{sessionsQuery.data?.length ?? 0} records</span></div>{sessionsQuery.isLoading ? <LoadingRows count={5} /> : sessionsQuery.error ? <div className="border border-[hsl(5_69%_48%_/_0.25)] bg-card p-6" data-testid="error-sessions"><CircleAlert className="text-[hsl(5_69%_48%)]" size={18} /><h3 className="mt-3 font-semibold">Sessions could not be loaded</h3><p className="mt-1 text-sm text-muted-foreground">The workspace history service did not respond. Retry from the browser when the API is available.</p></div> : sessionsQuery.data?.length ? <div className="overflow-x-auto border border-border bg-card"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-border bg-muted/60"><tr className="mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-5 py-3 font-medium">Question</th><th className="px-4 py-3 font-medium">Analyst</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Sources</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3" /></tr></thead><tbody>{sessionsQuery.data.map((item) => <tr className="border-b border-border/70 last:border-0 hover:bg-muted/35" key={item.id} data-testid={`row-session-${item.id}`}><td className="max-w-[430px] px-5 py-4"><div className="line-clamp-2 text-sm font-semibold text-foreground">{item.prompt}</div><div className="mono mt-1 text-[10px] text-muted-foreground">{item.classification}</div></td><td className="px-4 py-4 text-sm text-muted-foreground">{item.analyst}</td><td className="px-4 py-4 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</td><td className="px-4 py-4 mono text-xs text-muted-foreground">{item.sourceFiles.length.toString().padStart(2, '0')}</td><td className="px-4 py-4"><StatusPill status={item.status} /></td><td className="px-4 py-4 text-right"><button onClick={() => setLocation(`/?session=${item.id}`)} className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(174_44%_32%)] hover:underline" data-testid={`button-open-session-${item.id}`}>Open <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Clock3} title="No analysis sessions yet" detail="Your completed and in-progress questions will appear here." action={<Link href="/" className="inline-flex items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" data-testid="link-start-first-session"><Plus size={14} /> Start first session</Link>} />}</div>;
}

function StandardsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  return <div className="space-y-7"><div><div className="section-kicker">Review doctrine</div><h1 className="display mt-2 text-3xl font-bold tracking-tight">ICD-203 standards</h1><p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Nine review lenses keep production honest. Use them to interrogate the evidence, the reasoning, and the decision value of an assessment.</p></div><div className="grid gap-3 lg:grid-cols-2">{standards.map((standard, index) => <article className={`border bg-card transition-colors ${expanded === standard.id ? 'border-[hsl(39_92%_65%)]' : 'border-card-border'}`} key={standard.id} data-testid={`card-standard-${standard.id}`}><button onClick={() => setExpanded(expanded === standard.id ? null : standard.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left" data-testid={`button-expand-standard-${standard.id}`}><span className="mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{standard.name}</span><span className="mono mt-1 block text-[10px] uppercase tracking-[0.09em] text-muted-foreground">{standard.shortName}</span></span><span className="grid h-7 w-7 place-items-center border border-border text-muted-foreground">{expanded === standard.id ? <X size={13} /> : <ChevronRight size={14} />}</span></button>{expanded === standard.id ? <div className="border-t border-border/70 bg-muted/35 px-5 pb-5 pt-4"><div className="section-kicker">Review guidance</div><p className="mt-2 text-sm leading-6 text-foreground/80">{standard.finding}</p><div className="mt-4 border-l-2 border-[hsl(39_92%_65%)] pl-3 text-xs italic leading-5 text-muted-foreground">{standard.prompt}</div></div> : null}</article>)}</div><div className="border border-border bg-[hsl(222_38%_15%)] p-5 text-sidebar-foreground md:p-6"><div className="flex items-start gap-3"><ClipboardCheck size={18} className="mt-0.5 text-sidebar-primary" /><div><div className="section-kicker text-sidebar-foreground/55">In practice</div><p className="mt-2 max-w-2xl text-sm leading-6 text-sidebar-foreground/80">Standards are prompts for disciplined review, not a substitute for analyst judgment. A gap is a collection or reasoning task to resolve before release.</p></div></div></div></div>;
}

function SettingsPage() {
  const connectorsQuery = useListSourceConnectors();
  const healthQuery = useHealthCheck();
  return <div className="space-y-7"><div><div className="section-kicker">Workspace controls</div><h1 className="display mt-2 text-3xl font-bold tracking-tight">Settings</h1><p className="mt-2 text-sm text-muted-foreground">Review classification posture and source connector readiness. Configuration changes are managed by the workspace administrator.</p></div><div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]"><section className="border border-card-border bg-card p-5 md:p-6"><div className="flex items-center gap-3 border-b border-border/70 pb-4"><LockKeyhole size={18} className="text-[hsl(39_92%_48%)]" /><div><div className="text-sm font-semibold">Workspace classification</div><div className="text-xs text-muted-foreground">Applied at session creation</div></div></div><div className="mt-5 space-y-3">{['UNCLASSIFIED', 'CUI', 'SECRET', 'TS'].map((level, index) => <div className={`flex items-center justify-between border p-3 ${index === 0 ? 'border-[hsl(39_92%_65%)] bg-[hsl(39_92%_65%_/_0.09)]' : 'border-border bg-muted/30 opacity-65'}`} key={level}><div><div className="mono text-xs font-medium">{level}</div><div className="mt-1 text-[11px] text-muted-foreground">{index === 0 ? 'Available in this workspace' : 'Restricted by workspace policy'}</div></div>{index === 0 ? <Check size={15} className="text-[hsl(174_44%_43%)]" /> : <LockKeyhole size={13} className="text-muted-foreground" />}</div>)}</div></section><section className="border border-card-border bg-card p-5 md:p-6"><div className="flex items-center justify-between border-b border-border/70 pb-4"><div className="flex items-center gap-3"><Database size={18} className="text-[hsl(174_44%_43%)]" /><div><div className="text-sm font-semibold">Source connectors</div><div className="text-xs text-muted-foreground">Readiness is evaluated by the API</div></div></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`h-1.5 w-1.5 ${healthQuery.data?.status === 'ok' ? 'bg-[hsl(174_44%_43%)]' : 'bg-[hsl(39_92%_65%)]'}`} />API {healthQuery.isLoading ? 'checking' : healthQuery.data?.status ?? 'unavailable'}</div></div>{connectorsQuery.isLoading ? <div className="mt-5"><LoadingRows count={3} /></div> : connectorsQuery.error ? <div className="mt-5"><EmptyState icon={CircleAlert} title="Readiness is unavailable" detail="The connector registry could not be reached. No connector is presented as ready." /></div> : <div className="mt-5 space-y-2">{connectorsQuery.data?.map((connector) => <div className="flex items-center gap-3 border border-border/75 p-3" key={connector.id} data-testid={`row-connector-${connector.id}`}><div className="grid h-8 w-8 place-items-center bg-muted text-muted-foreground"><Network size={15} /></div><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{connector.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{connector.description}</div></div><StatusPill status={connector.status} /></div>)}{!connectorsQuery.data?.length ? <EmptyState icon={Network} title="No connectors configured" detail="There are no source adapters available to this workspace." /> : null}</div>}</section></div></div>;
}

function Router() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><AppShell><Switch><Route path="/" component={Home} /><Route path="/sessions" component={SessionsPage} /><Route path="/standards" component={StandardsPage} /><Route path="/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></AppShell></ErrorBoundary>;
}

function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}><Router /></WouterRouter><Toaster /></TooltipProvider></QueryClientProvider>;
}

export default App;