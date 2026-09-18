import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import '@clerk/themes/shadcn.css';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useAuth, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
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
  Minus,
  Network,
  Play,
  Plus,
  Radio,
  Search,
  Settings2,
  ShieldCheck,
  SlidersHorizontal,
  Target,
  TrendingDown,
  TrendingUp,
  X,
  Zap,
} from 'lucide-react';
import {
  AnalysisSessionClassification,
  AnalyticStandardStatus,
  SourceConnectorStatus,
  useCreateAnalysisSession,
  useCreateAssessment,
  useListCurrentEvents,
  useGetAnalysisSession,
  useHealthCheck,
  useListAnalysisSessions,
  useListAnalysisStarters,
  useListSourceConnectors,
  useListEvaluationVectors,
  useRunResearch,
  useUpdateIncidentReview,
  getAnalysisSession,
  getGetAnalysisSessionQueryKey,
  type AnalysisSession,
  type AnalyticStandard,
  type SourceConnector,
  type SourceFile,
  type Incident,
} from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation } from 'wouter';
import NotFound from '@/pages/not-found';
import { StarterPanel } from './workbench/StarterPanel';
import { EvaluationVectorOverview } from './workbench/EvaluationVectorOverview';
import { downloadAnalyticReviewReport } from './workbench/report';
import { restoreWorkspaceForm } from './workbench/starters';

const queryClient = new QueryClient();
const clerkPubKey = publishableKeyFromHost(
  window.location.hostname,
  import.meta.env.VITE_CLERK_PUBLISHABLE_KEY,
);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

if (!clerkPubKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
}

const clerkAppearance = {
  theme: shadcn,
  cssLayerName: 'clerk',
  options: {
    logoPlacement: 'inside' as const,
    logoLinkUrl: basePath || '/',
    logoImageUrl: `${window.location.origin}${basePath}/logo.svg`,
    socialButtonsPlacement: 'bottom' as const,
  },
  variables: {
    colorPrimary: 'hsl(222, 38%, 22%)',
    colorForeground: 'hsl(222, 32%, 18%)',
    colorMutedForeground: 'hsl(218, 13%, 38%)',
    colorDanger: 'hsl(5, 69%, 42%)',
    colorBackground: 'hsl(0, 0%, 100%)',
    colorInput: 'hsl(0, 0%, 100%)',
    colorInputForeground: 'hsl(222, 32%, 18%)',
    colorNeutral: 'hsl(220, 18%, 76%)',
    fontFamily: 'DM Sans, sans-serif',
    borderRadius: '0.4rem',
  },
  elements: {
    rootBox: 'w-full flex justify-center',
    cardBox: 'w-[440px] max-w-full overflow-hidden border border-slate-200 bg-white shadow-2xl',
    card: '!border-0 !bg-transparent !shadow-none !rounded-none',
    footer: '!border-0 !bg-transparent !shadow-none',
    headerTitle: 'font-semibold text-slate-900',
    headerSubtitle: 'text-slate-600',
    socialButtonsBlockButtonText: 'text-slate-800',
    formFieldLabel: 'text-slate-800',
    footerActionLink: 'font-semibold text-slate-900',
    footerActionText: 'text-slate-600',
    dividerText: 'text-slate-500',
    identityPreviewEditButton: 'text-slate-800',
    formFieldSuccessText: 'text-emerald-700',
    alertText: 'text-slate-800',
    logoBox: 'mb-2',
    logoImage: 'h-10 w-10',
    socialButtonsBlockButton: 'border border-slate-300 bg-white hover:bg-slate-50',
    formButtonPrimary: 'bg-slate-900 hover:bg-slate-800 text-white',
    formFieldInput: 'border-slate-300 bg-white text-slate-900',
    footerAction: 'border-t border-slate-200',
    dividerLine: 'bg-slate-200',
    alert: 'border border-slate-200 bg-slate-50',
    otpCodeFieldInput: 'border-slate-300 text-slate-900',
    formFieldRow: 'gap-1.5',
    main: 'gap-5',
  },
};

function stripBase(path: string): string {
  return basePath && path.startsWith(basePath)
    ? path.slice(basePath.length) || '/'
    : path;
}

const navItems = [
  { href: '/user-portal', label: 'Workbench', icon: Target },
  { href: '/user-portal/sessions', label: 'Sessions', icon: Layers3 },
  { href: '/user-portal/standards', label: 'ICD-203 standards', icon: BookOpen },
  { href: '/user-portal/settings', label: 'Settings', icon: Settings2 },
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
  if (status === 'COMPLETE' || status === 'READY' || status === 'PASS' || status === 'STRONG') return 'bg-[hsl(174_44%_43%_/_0.13)] text-[hsl(174_44%_32%)] border-[hsl(174_44%_43%_/_0.3)]';
  if (status === 'RESEARCHING' || status === 'ASSESSING' || status === 'REVIEW' || status === 'MIXED') return 'bg-[hsl(39_92%_65%_/_0.18)] text-[hsl(30_69%_32%)] border-[hsl(39_92%_65%_/_0.45)]';
  if (status === 'GAP' || status === 'NEEDS_CONFIGURATION' || status === 'WEAK') return 'bg-[hsl(5_69%_48%_/_0.1)] text-[hsl(5_69%_40%)] border-[hsl(5_69%_48%_/_0.25)]';
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

function LogoutButton() {
  const { signOut } = useClerk();
  const signOutOfWorkbench = async () => {
    // The cache can hold user-scoped research records. Clear it before Clerk
    // removes the cookie so a subsequent account cannot see stale results.
    await queryClient.cancelQueries();
    queryClient.clear();
    await signOut({ redirectUrl: basePath || '/' });
  };
  return <button type="button" onClick={signOutOfWorkbench} className="mono text-[10px] uppercase tracking-[0.12em] text-sidebar-foreground/55 hover:text-white" data-testid="button-logout">Sign out</button>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location, setLocation] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const { user } = useUser();
  const activePath = location.split('?')[0];
  const analystName = user?.fullName || user?.firstName || 'Analyst';
  const analystInitials = analystName.split(/\s+/).filter(Boolean).map((part) => part[0]).join('').slice(0, 2).toUpperCase() || 'AN';
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
          <p className="mt-2 text-xs leading-5 text-sidebar-foreground/55">Classification marking restricts public collection only; it does not classify content. This environment is unapproved for classified data.</p>
        </div>
        <div className="flex items-center gap-3 border-t border-sidebar-border pt-4"><div className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(39_92%_65%_/_0.2)] mono text-xs font-medium text-sidebar-primary">{analystInitials}</div><div className="min-w-0"><div className="truncate text-xs font-semibold text-white">{analystName}</div><div className="truncate mono text-[10px] text-sidebar-foreground/50">{user?.primaryEmailAddress?.emailAddress ?? 'Authenticated analyst'}</div></div><div className="ml-auto flex items-center gap-2"><button onClick={() => setLocation('/user-portal/settings')} className="text-sidebar-foreground/50 hover:text-white" data-testid="button-profile-settings" aria-label="Open settings"><Settings2 size={15} /></button><LogoutButton /></div></div>
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

function ConnectorPicker({ connectors, selected, setSelected, loading, error, classification }: { connectors?: SourceConnector[]; selected: string[]; setSelected: (ids: string[]) => void; loading: boolean; error: boolean; classification: keyof typeof AnalysisSessionClassification }) {
  if (loading) return <div className="grid gap-2 md:grid-cols-2"><div className="h-[72px] animate-pulse bg-muted" /><div className="h-[72px] animate-pulse bg-muted" /></div>;
  if (error) return <div className="flex items-start gap-3 border border-[hsl(5_69%_48%_/_0.25)] bg-[hsl(5_69%_48%_/_0.06)] p-4 text-sm" data-testid="error-connectors"><CircleAlert size={17} className="mt-0.5 text-[hsl(5_69%_48%)]" /><div><div className="font-semibold text-foreground">Connector registry unavailable</div><p className="mt-1 text-muted-foreground">Research cannot be run until source readiness can be verified.</p></div></div>;
  if (!connectors?.length) return <EmptyState icon={Network} title="No source adapters configured" detail="Ask a workspace administrator to configure at least one connector before running research." />;
  
  const isRestricted = classification !== 'UNCLASSIFIED';

  return <div className="flex flex-col gap-3">
    {isRestricted && (
      <div className="flex items-start gap-2 border-l-2 border-[hsl(39_92%_65%)] bg-[hsl(39_92%_65%_/_0.1)] px-3 py-2 text-xs text-muted-foreground">
        <LockKeyhole size={14} className="mt-0.5 shrink-0 text-[hsl(30_69%_32%)]" />
        <p>Live research is disabled for {classification}. No prompts or queries will be sent to public providers. Only synthetic demonstration adapters are available.</p>
      </div>
    )}
    <div className="grid gap-2 md:grid-cols-2" data-testid="connector-list">{connectors.map((connector) => {
      const isLive = connector.mode === 'LIVE';
      const isDisabledByClassification = isRestricted && isLive;
      const ready = connector.status === SourceConnectorStatus.READY && !isDisabledByClassification;
      const active = selected.includes(connector.id);
      
      return <button type="button" disabled={!ready} aria-pressed={active} key={connector.id} onClick={() => setSelected(active ? selected.filter((id) => id !== connector.id) : [...selected, connector.id])} className={`flex items-start gap-3 border p-3 text-left transition-all ${active ? 'border-[hsl(39_92%_65%)] bg-[hsl(39_92%_65%_/_0.1)]' : 'border-border bg-card hover:border-[hsl(39_92%_65%_/_0.65)]'} ${!ready ? 'cursor-not-allowed opacity-55' : ''}`} data-testid={`button-connector-${connector.id}`}>
        <span className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center border ${active ? 'border-primary bg-primary text-primary-foreground' : 'border-input bg-background'}`}>{active ? <Check size={11} /> : null}</span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-2"><span className="text-sm font-semibold text-foreground flex items-center gap-2">{connector.name} {isLive ? <span className="inline-flex items-center border border-[hsl(174_44%_43%_/_0.4)] bg-[hsl(174_44%_43%_/_0.1)] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-[hsl(174_44%_32%)]">LIVE</span> : <span className="inline-flex items-center border border-[hsl(39_92%_65%_/_0.4)] bg-[hsl(39_92%_65%_/_0.1)] px-1.5 py-0.5 text-[9px] font-semibold tracking-[0.08em] text-[hsl(30_69%_32%)]">SYNTHETIC</span>}</span><StatusPill status={connector.status} /></span><span className="mt-1 block text-xs leading-5 text-muted-foreground">{connector.description}</span><span className="mono mt-2 block text-[9px] uppercase tracking-[0.08em] text-muted-foreground/80">{connector.sourceTypes.join(' / ')}</span></span>
      </button>;
    })}</div>
  </div>;
}

function SourceCard({ source, selected, onToggle }: { source: SourceFile; selected: boolean; onToggle: () => void }) {
  return <article className={`relative border bg-card p-5 transition-all ${selected ? 'border-[hsl(39_92%_65%)] shadow-[inset_3px_0_0_hsl(39_92%_65%)]' : 'border-card-border hover:border-[hsl(220_18%_74%)]'}`} data-testid={`card-source-${source.id}`}>
    <div className="flex items-start justify-between gap-4"><div className="flex min-w-0 items-center gap-2"><span className="grid h-7 w-7 shrink-0 place-items-center bg-secondary text-secondary-foreground"><FileText size={14} /></span><div className="min-w-0"><div className="mono truncate text-[10px] uppercase tracking-[0.09em] text-muted-foreground">{source.source} / {source.sourceType}</div><h3 className="mt-1 line-clamp-2 text-sm font-semibold leading-5 text-foreground">{source.title}</h3></div></div><button type="button" onClick={onToggle} className={`grid h-7 w-7 shrink-0 place-items-center border transition-colors ${selected ? 'border-primary bg-primary text-primary-foreground' : 'border-input text-muted-foreground hover:border-primary hover:text-primary'}`} aria-label={selected ? 'Remove source from assessment' : 'Select source for assessment'} data-testid={`button-select-source-${source.id}`}>{selected ? <Check size={14} /> : <Plus size={15} />}</button></div>
    <div className="mt-4 border-l-2 border-[hsl(39_92%_65%_/_0.7)] pl-3 text-[13px] leading-5 text-foreground/85"><span className="mono mr-2 text-[9px] uppercase tracking-[0.12em] text-muted-foreground">BLUF</span>{source.bluf}</div>
    <div className="mt-3 flex items-center gap-4 text-[10px] text-muted-foreground">
      {source.collectionMethod && <div className="flex items-center gap-1.5"><Database size={12} /><span className="mono uppercase tracking-[0.08em]">{source.collectionMethod}</span></div>}
      {source.retrievedAt && <div className="flex items-center gap-1.5"><Clock3 size={12} /><span className="mono uppercase tracking-[0.08em]">{formatDateTime(source.retrievedAt)}</span></div>}
    </div>
    <div className="mt-4 grid grid-cols-2 gap-3 border-t border-border/70 pt-3"><div><div className="mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Relevance</div><div className="mt-1 flex items-center gap-2"><div className="h-1.5 flex-1 bg-secondary"><div className="h-full bg-[hsl(174_44%_43%)]" style={{ width: `${Math.round(source.relevance * 100)}%` }} /></div><span className="mono text-[10px] font-medium">{Math.round(source.relevance * 100)}%</span></div></div><div><div className="mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">Reliability</div><div className="mt-1"><StatusPill status={source.reliability} /></div></div></div>
    <div className="mt-4 flex flex-wrap gap-1.5">{source.tags.map((tag, index) => <span className="mono border border-border bg-muted px-1.5 py-0.5 text-[9px] uppercase tracking-[0.08em] text-muted-foreground" key={`${tag}-${index}`}>{tag}</span>)}</div>
    <a className="mt-4 inline-flex items-center gap-1 text-xs font-semibold text-[hsl(174_44%_32%)] hover:underline" href={source.url} target="_blank" rel="noreferrer" data-testid={`link-source-${source.id}`}>Open source <ArrowUpRight size={12} /></a>
  </article>;
}

export function Home() {
  const [location, setLocation] = useLocation();
  const querySessionId = new URLSearchParams(window.location.search).get('session');
  const [prompt, setPrompt] = useState('');
  const [classification, setClassification] = useState<keyof typeof AnalysisSessionClassification>('UNCLASSIFIED');
  const [classificationHydrated, setClassificationHydrated] = useState(() => !querySessionId);
  const [selectedConnectors, setSelectedConnectors] = useState<string[]>([]);
  const [selectedSources, setSelectedSources] = useState<string[]>([]);
  const [activeSessionId, setActiveSessionId] = useState(querySessionId ?? '');
  const [createdSession, setCreatedSession] = useState<AnalysisSession | null>(null);
  const [researchResult, setResearchResult] = useState<AnalysisSession | null>(null);
  const [actionError, setActionError] = useState('');
  const hydratedSessionId = useRef('');
  const locallyCreatedSessionId = useRef('');
  const connectorsInitialized = useRef(false);
  const previousClassification = useRef(classification);
  const [connectorResetToken, setConnectorResetToken] = useState(0);

  useEffect(() => {
    setActiveSessionId(querySessionId ?? '');
    setClassificationHydrated(!querySessionId);
    setCreatedSession(null);
    setResearchResult(null);
    setSelectedSources([]);
    hydratedSessionId.current = '';
    if (querySessionId) {
      // Do not let a public feed request continue while the saved session's
      // authoritative classification is being loaded.
      void queryClient.cancelQueries({ queryKey: ['current-events'] });
    }
  }, [querySessionId]);
  const connectorsQuery = useListSourceConnectors();
  const sessionQuery = useGetAnalysisSession(activeSessionId, { query: { enabled: Boolean(activeSessionId), queryKey: getGetAnalysisSessionQueryKey(activeSessionId) } });
  const startersQuery = useListAnalysisStarters();
  const sessionClassificationReady = !querySessionId || (
    classificationHydrated
    && sessionQuery.data?.id === querySessionId
  );
  const currentEventsEnabled = sessionClassificationReady && classification === 'UNCLASSIFIED';
  const currentEventsQuery = useListCurrentEvents(
    { classification },
    { query: { enabled: currentEventsEnabled, queryKey: ['current-events', classification] } },
  );
  const vectorsQuery = useListEvaluationVectors();
  const createSession = useCreateAnalysisSession();
  const runResearch = useRunResearch();
  const createAssessment = useCreateAssessment();
  const session = activeSessionId ? researchResult ?? sessionQuery.data ?? createdSession : null;
  const sources = session?.sourceFiles ?? [];
  const canResearch = Boolean(session?.id && selectedConnectors.length && !runResearch.isPending);

  useEffect(() => {
    if (!connectorsQuery.data?.length) return;
    const permittedMode = classification === 'UNCLASSIFIED' ? 'LIVE' : 'DEMONSTRATION';
    const permitted = connectorsQuery.data
      .filter((connector) => connector.status === 'READY' && connector.mode === permittedMode)
      .map((connector) => connector.id);
    const classificationChanged = previousClassification.current !== classification;
    previousClassification.current = classification;
    setSelectedConnectors((current) => {
      const normalized = current.filter((id) => permitted.includes(id));
      if (!connectorsInitialized.current || (classificationChanged && current.length > 0 && normalized.length === 0)) {
        connectorsInitialized.current = true;
        return permitted;
      }
      return normalized;
    });
  }, [classification, connectorResetToken, connectorsQuery.data]);

  useEffect(() => {
    const loaded = sessionQuery.data;
    // A route opened from Sessions has no local creation state. Hydrate from
    // the fetched record in that case, rather than relying on the starter
    // panel's resume callback (which Sessions does not use).
    if (
      !loaded
      || querySessionId !== loaded.id
      || locallyCreatedSessionId.current === loaded.id
      || hydratedSessionId.current === loaded.id
    ) return;
    const restored = restoreWorkspaceForm(loaded);
    setPrompt(restored.prompt);
    setClassification(restored.classification);
    setSelectedConnectors(restored.selectedConnectors);
    setSelectedSources(restored.selectedSources);
    connectorsInitialized.current = true;
    hydratedSessionId.current = loaded.id;
     setClassificationHydrated(true);
     if (restored.classification !== 'UNCLASSIFIED') {
       void queryClient.cancelQueries({ queryKey: ['current-events'] });
     }
  }, [sessionQuery.data]);

  useEffect(() => {
    // Hydrated saved selection is authoritative, including an intentionally
    // empty selection. Only a locally-created/researched session gets the
    // first-two convenience default.
    if (session && hydratedSessionId.current === session.id) return;
    if (session?.sourceFiles?.length && selectedSources.length === 0) setSelectedSources(session.sourceFiles.slice(0, 2).map((source) => source.id));
  }, [session?.id, session?.sourceFiles, selectedSources.length]);

  const startSession = () => {
    setActionError('');
    if (prompt.trim().length < 5) { setActionError('Enter a research question with at least five characters.'); return; }
    if (!selectedConnectors.length) { setActionError('Select at least one ready source adapter.'); return; }
    createSession.mutate({ data: { prompt: prompt.trim(), analyst: 'A. Reyes', classification: AnalysisSessionClassification[classification] } }, {
      onSuccess: (nextSession) => {
        locallyCreatedSessionId.current = nextSession.id;
        setCreatedSession(nextSession);
        setActiveSessionId(nextSession.id);
        setResearchResult(null);
        setLocation(`/user-portal?session=${nextSession.id}`);
        runResearch.mutate(
          { sessionId: nextSession.id, data: { sourceConnectorIds: selectedConnectors, maxResults: 12 } },
          {
            onSuccess: (result) => { setResearchResult(result); setSelectedSources([]); },
            onError: () => setActionError('The question was saved, but research did not complete. Use “Run research” below to retry.'),
          },
        );
      },
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
  const useAsNewQuestion = (question: string) => {
    setPrompt(question);
    setActiveSessionId('');
    setCreatedSession(null);
    setResearchResult(null);
    setSelectedSources([]);
    setClassification('UNCLASSIFIED');
    locallyCreatedSessionId.current = '';
    connectorsInitialized.current = false;
    setConnectorResetToken((value) => value + 1);
    setActionError('');
    setLocation('/user-portal');
  };
  const resumeSession = (sessionId: string) => setLocation(`/user-portal?session=${sessionId}`);
  return <div className="space-y-8">
    <div className="rise flex flex-col justify-between gap-5 lg:flex-row lg:items-end"><div><div className="section-kicker">Active production cell / {session ? `Session ${session.id.slice(0, 8)}` : 'New session'}</div><h1 className="display mt-2 max-w-3xl text-3xl font-bold tracking-[-0.03em] text-foreground md:text-[40px]">Draft a provisional assessment from a research question.</h1><p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">Trace the research workflow. Every drafted judgment starts with a bounded question, a declared source posture, and visible uncertainty.</p></div><div className="flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs text-muted-foreground"><ShieldCheck size={15} className="text-[hsl(174_44%_43%)]" /><span>Supports ICD-203 review</span></div></div>
    <section className="scanline panel-shadow border border-card-border bg-card" data-testid="panel-research-question">
      <div className="flex items-center justify-between border-b border-border/75 px-5 py-4 md:px-6"><div className="flex items-center gap-3"><span className="mono grid h-6 w-6 place-items-center bg-primary text-[10px] text-primary-foreground">01</span><div><div className="text-sm font-semibold">Frame the question</div><div className="text-xs text-muted-foreground">Define the decision space before you collect.</div></div></div><StatusPill status={session?.status ?? 'DRAFT'} /></div>
      <div className="p-5 md:p-6"><label htmlFor="research-prompt" className="section-kicker">Intelligence question</label><textarea id="research-prompt" rows={4} value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="What do you need to know, and by when?" className="mt-2 w-full resize-none border border-input bg-background px-4 py-3 text-sm leading-6 text-foreground placeholder:text-muted-foreground/70 focus:border-primary" data-testid="input-research-prompt" /><div className="mt-3 flex flex-wrap items-center gap-3"><label className="mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground" htmlFor="classification">Classification marking</label><select id="classification" value={classification} onChange={(event) => { const nextClassification = event.target.value as keyof typeof AnalysisSessionClassification; setClassification(nextClassification); if (nextClassification !== 'UNCLASSIFIED') void queryClient.cancelQueries({ queryKey: ['current-events'] }); }} className="border border-input bg-background px-2.5 py-1.5 text-xs text-foreground" data-testid="select-classification">{Object.values(AnalysisSessionClassification).map((value) => <option key={value} value={value}>{value}</option>)}</select><span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground"><LockKeyhole size={12} /> Records provenance; it does not classify text automatically.</span></div><p className="mt-2 max-w-3xl text-[11px] leading-5 text-[hsl(30_69%_32%)]">This development environment is not approved to hold classified information. A non-UNCLASSIFIED marking only restricts public collection; do not enter classified material.</p><StarterPanel starters={startersQuery.data} loading={startersQuery.isLoading} onUseQuestion={useAsNewQuestion} onOpenSession={resumeSession} currentEvents={currentEventsEnabled ? currentEventsQuery.data : undefined} currentEventsLoading={!sessionClassificationReady || (currentEventsEnabled && currentEventsQuery.isLoading)} currentEventsError={currentEventsEnabled && Boolean(currentEventsQuery.error)} currentEventsRestricted={sessionClassificationReady && classification !== 'UNCLASSIFIED'} currentEventsRefreshing={currentEventsEnabled && currentEventsQuery.isFetching} onRefreshCurrentEvents={currentEventsEnabled ? () => { void currentEventsQuery.refetch(); } : undefined} /><details className="mt-5 border border-border bg-muted/20"><summary className="cursor-pointer px-4 py-3 text-sm font-semibold">Collection settings <span className="ml-2 text-xs font-normal text-muted-foreground">Choose source providers; evidence stays in the source board below.</span></summary><div className="border-t border-border p-4"><div className="section-kicker">Source posture</div><p className="mt-2 text-xs leading-5 text-muted-foreground">Ready public adapters are selected by default. A non-UNCLASSIFIED marking blocks public providers; demonstration records remain synthetic.</p><div className="mt-4"><ConnectorPicker connectors={connectorsQuery.data} selected={selectedConnectors} setSelected={setSelectedConnectors} loading={connectorsQuery.isLoading} error={Boolean(connectorsQuery.error)} classification={classification} /></div></div></details><button onClick={startSession} disabled={isBusy} className="mt-5 inline-flex items-center gap-2 bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-create-session">{isBusy ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}{runResearch.isPending ? 'Researching selected sources…' : session ? 'Research as a new question' : 'Research question'}</button></div>
      {actionError ? <div className="flex items-center gap-2 border-t border-[hsl(5_69%_48%_/_0.22)] bg-[hsl(5_69%_48%_/_0.05)] px-5 py-3 text-xs text-[hsl(5_69%_40%)]" data-testid="error-workbench-action"><CircleAlert size={14} />{actionError}<button className="ml-auto" onClick={() => setActionError('')} aria-label="Dismiss error" data-testid="button-dismiss-error"><X size={14} /></button></div> : null}
    </section>
    <EvaluationVectorOverview vectors={vectorsQuery.data} results={session?.assessment?.vectorResults} loading={vectorsQuery.isLoading} />
    <section className="rise rise-delay-1" data-testid="panel-research-results">
      <div className="mb-4 flex flex-col justify-between gap-3 sm:flex-row sm:items-end">
        <div>
          <div className="section-kicker">02 / Source review</div>
          <h2 className="display mt-1 text-2xl font-bold tracking-tight">BLUF source board</h2>
        </div>
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          <span className="mono">{selectedSources.length} selected</span>
          {session?.status === 'READY_FOR_SELECTION' ? <button onClick={beginAssessment} disabled={createAssessment.isPending || !selectedSources.length} className="inline-flex items-center gap-2 bg-[hsl(174_44%_32%)] px-3 py-2 font-semibold text-white transition-opacity hover:opacity-90 disabled:opacity-45" data-testid="button-start-assessment">{createAssessment.isPending ? <Loader2 size={14} className="animate-spin" /> : <ClipboardCheck size={14} />}Start assessment</button> : null}
        </div>
      </div>
      
      {session?.sourceNotices && session.sourceNotices.length > 0 ? (
        <div className="mb-5 border border-[hsl(39_92%_65%_/_0.4)] bg-[hsl(39_92%_65%_/_0.1)] p-4 text-sm text-[hsl(30_69%_32%)]">
          <div className="mb-2 flex items-center gap-2 font-semibold"><CircleAlert size={15}/> Provider Notices</div>
          <ul className="list-inside list-disc space-y-1 pl-1">
            {session.sourceNotices.map((notice, i) => <li key={i}>{notice}</li>)}
          </ul>
        </div>
      ) : null}

      {sessionQuery.isLoading && activeSessionId ? (
        <LoadingRows count={2} />
      ) : sources.length ? (
        <div className="grid gap-4 xl:grid-cols-2">
          {sources.map((source) => <SourceCard key={source.id} source={source} selected={selectedSources.includes(source.id)} onToggle={() => setSelectedSources((current) => current.includes(source.id) ? current.filter((id) => id !== source.id) : [...current, source.id])} />)}
        </div>
      ) : (
        <EmptyState 
          icon={Radio} 
          title={session?.sourceNotices?.length ? "Research returned no results" : "No retrieved findings yet"} 
          detail={session ? (session.sourceNotices?.length ? "The selected providers failed to return any valid sources for this query. See provider notices above." : 'Run research with one or more ready adapters. Results will appear here with BLUF summaries, source metadata, and reliability signals.') : 'Create an analysis session to unlock the source board.'} 
          action={!session ? <button onClick={() => document.getElementById('research-prompt')?.focus()} className="inline-flex items-center gap-2 border border-border bg-card px-3 py-2 text-xs font-semibold hover:border-primary" data-testid="button-focus-question"><Target size={14} />Focus the question</button> : <button onClick={executeResearch} disabled={!canResearch} className="inline-flex items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-45" data-testid="button-run-research"><Radio size={14} />Run research</button>} 
        />
      )}
    </section>
    {session?.assessment ? <AssessmentSummary session={session} onUpdated={setResearchResult} /> : null}
  </div>;
}

export function CountAnswerReview({ session, onUpdated }: { session: AnalysisSession; onUpdated: (session: AnalysisSession) => void }) {
  const answer = session.assessment!.countAnswer!;
  const [incidents, setIncidents] = useState<Incident[]>(answer.incidents);
  const [showAdd, setShowAdd] = useState(false);
  const [draft, setDraft] = useState({ date: '', location: '', description: '', sourceFileId: '' });
  const [draftEvidenceError, setDraftEvidenceError] = useState('');
  const [saveError, setSaveError] = useState<'conflict' | 'generic' | ''>('');
  const [reloadError, setReloadError] = useState(false);
  const [confirmReload, setConfirmReload] = useState(false);
  const [isReloading, setIsReloading] = useState(false);
  const updateReview = useUpdateIncidentReview();
  useEffect(() => {
    setIncidents(answer.incidents);
    setSaveError('');
    setReloadError(false);
    setConfirmReload(false);
  }, [answer.incidents]);
  const includedCount = incidents.filter((incident) => incident.status === 'INCLUDED').length;
  const hasIncompleteIncludedEvidence = incidents.some((incident) => {
    if (incident.status !== 'INCLUDED' || incident.sourceFileIds.length === 0) return incident.status === 'INCLUDED';
    return incident.sourceFileIds.some((sourceId) => {
      const source = session.sourceFiles.find((item) => item.id === sourceId);
      return !source || !(incident.evidenceSpans ?? []).some((span) =>
        span.sourceFileId === sourceId
        && span.startChar >= 0
        && span.endChar <= source.content.length
        && source.content.slice(span.startChar, span.endChar) === span.text
      );
    });
  });
  const hasSupportedAnswer = includedCount > 0;
  const save = (finalized: boolean) => {
    setSaveError('');
    setReloadError(false);
    setConfirmReload(false);
    updateReview.mutate(
      { sessionId: session.id, data: { incidents, finalized, expectedVersion: session.version } },
      {
        onSuccess: onUpdated,
        onError: (error) => setSaveError(
          typeof error === 'object' && error !== null && 'status' in error && error.status === 409
            ? 'conflict'
            : 'generic',
        ),
      },
    );
  };
  const reloadCurrentReview = async () => {
    setIsReloading(true);
    setReloadError(false);
    try {
      const currentSession = await getAnalysisSession(session.id, { cache: 'no-store' });
      onUpdated(currentSession);
      setIncidents(currentSession.assessment?.countAnswer?.incidents ?? []);
      setDraft({ date: '', location: '', description: '', sourceFileId: '' });
      setDraftEvidenceError('');
      setShowAdd(false);
      setSaveError('');
      setReloadError(false);
      setConfirmReload(false);
    } catch {
      setReloadError(true);
      setConfirmReload(false);
    } finally {
      setIsReloading(false);
    }
  };
  const addIncident = () => {
    if (!draft.date || !draft.location || !draft.description || !draft.sourceFileId) return;
    const supportingSource = session.sourceFiles.find((source) => source.id === draft.sourceFileId);
    const evidenceText = draft.description.trim();
    const startChar = supportingSource?.content.indexOf(evidenceText) ?? -1;
    if (!supportingSource || startChar < 0) {
      setDraftEvidenceError('Paste an exact supporting sentence from the selected source.');
      return;
    }
    setIncidents((current) => [...current, {
      id: crypto.randomUUID(),
      date: new Date(`${draft.date}T12:00:00Z`).toISOString(),
      location: draft.location,
      parties: answer.requestedParties,
      description: evidenceText,
      sourceFileIds: [draft.sourceFileId],
      evidenceSpans: [{
        sourceFileId: draft.sourceFileId,
        text: evidenceText,
        startChar,
        endChar: startChar + evidenceText.length,
      }],
      status: 'INCLUDED',
    }]);
    setDraft({ date: '', location: '', description: '', sourceFileId: '' });
    setDraftEvidenceError('');
    setShowAdd(false);
  };
  return <div className="mt-6 border border-[hsl(174_44%_43%_/_0.35)] bg-card" data-testid="panel-count-answer">
    <div className="flex flex-col gap-4 border-b border-border p-5 sm:flex-row sm:items-center sm:justify-between">
      <div><div className="section-kicker">Direct answer</div>{hasSupportedAnswer ? <div className="mt-2 flex items-baseline gap-3"><span className="display text-5xl font-bold text-[hsl(174_44%_32%)]">{includedCount}</span><span className="text-sm font-semibold">distinct incidents provisionally included</span></div> : <div className="mt-2 text-xl font-bold text-[hsl(30_69%_32%)]">Insufficient evidence for a factual count</div>}<p className="mt-2 text-xs text-muted-foreground">{answer.question}</p></div>
      <div className="flex items-center gap-2"><span className="text-xs font-semibold">Confidence</span><StatusPill status={answer.confidence} /></div>
    </div>
    <div className="border-b border-border bg-muted/35 px-5 py-3 text-xs leading-5 text-muted-foreground"><span className="font-semibold text-foreground">Inclusion criteria:</span> {answer.inclusionCriteria}</div>
    <div className="overflow-x-auto">
      <table className="w-full min-w-[820px] text-left text-xs">
        <thead className="mono border-b border-border bg-muted/25 text-[9px] uppercase tracking-[0.1em] text-muted-foreground"><tr><th className="px-4 py-3">Include</th><th className="px-4 py-3">Date</th><th className="px-4 py-3">Location / parties</th><th className="px-4 py-3">Incident</th><th className="px-4 py-3">Citations</th></tr></thead>
        <tbody className="divide-y divide-border">
          {incidents.map((incident) => <tr key={incident.id} className={incident.status === 'EXCLUDED' ? 'opacity-50' : ''}>
            <td className="px-4 py-4"><button onClick={() => setIncidents((current) => current.map((item) => item.id === incident.id ? { ...item, status: item.status === 'INCLUDED' ? 'EXCLUDED' : 'INCLUDED' } : item))} className={`grid h-6 w-6 place-items-center border ${incident.status === 'INCLUDED' ? 'border-primary bg-primary text-primary-foreground' : 'border-input'}`} aria-label={incident.status === 'INCLUDED' ? 'Remove incident from count' : 'Approve incident'}>{incident.status === 'INCLUDED' ? <Check size={13} /> : null}</button></td>
            <td className="px-4 py-4 font-semibold">{formatDate(incident.date)}</td>
            <td className="px-4 py-4"><div className="font-semibold">{incident.location}</div><div className="mt-1 text-muted-foreground">{incident.parties.join(' / ')}</div></td>
            <td className="max-w-md px-4 py-4 leading-5">{incident.description}</td>
            <td className="px-4 py-4">{incident.sourceFileIds.length ? <div className="space-y-1">{incident.sourceFileIds.map((id) => { const source = session.sourceFiles.find((item) => item.id === id); return source ? <a key={id} href={source.url} target="_blank" rel="noreferrer" className="block font-semibold text-[hsl(174_44%_32%)] hover:underline">[{session.sourceFiles.indexOf(source) + 1}] {source.source}</a> : null; })}</div> : <span className="text-[hsl(30_69%_32%)]">Analyst-added; citation needed</span>}</td>
          </tr>)}
          {!incidents.length ? <tr><td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">No affirmative, dated incidents supported by report excerpts were extracted. This is not evidence of zero incidents. Add a cited incident if the reporting supports one.</td></tr> : null}
        </tbody>
      </table>
    </div>
    {showAdd ? <div className="grid gap-3 border-t border-border bg-muted/20 p-4 md:grid-cols-2">
      <input type="date" value={draft.date} onChange={(e) => setDraft({ ...draft, date: e.target.value })} className="border border-input bg-background px-3 py-2" aria-label="Incident date" />
      <input value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value })} placeholder="Location" className="border border-input bg-background px-3 py-2" />
      <div className="border border-input bg-background px-3 py-2 text-xs text-muted-foreground md:col-span-2">Parties: <span className="font-semibold text-foreground">{answer.requestedParties.join(' / ')}</span></div>
      <select value={draft.sourceFileId} onChange={(e) => { setDraft({ ...draft, sourceFileId: e.target.value }); setDraftEvidenceError(''); }} className="border border-input bg-background px-3 py-2 md:col-span-2" aria-label="Supporting source">
        <option value="">Select a supporting source</option>
        {session.sourceFiles.filter((source) => session.assessment!.selectedSourceFileIds.includes(source.id) && source.contentDepth !== 'METADATA').map((source) => <option key={source.id} value={source.id}>[{session.sourceFiles.indexOf(source) + 1}] {source.source}: {source.title}</option>)}
      </select>
      <textarea value={draft.description} onChange={(e) => { setDraft({ ...draft, description: e.target.value }); setDraftEvidenceError(''); }} placeholder="Paste the supporting incident sentence from the selected source" className="border border-input bg-background px-3 py-2 md:col-span-2" />
      {draftEvidenceError ? <div className="text-xs font-semibold text-[hsl(5_69%_40%)] md:col-span-2" role="alert" data-testid="error-incident-evidence">{draftEvidenceError}</div> : null}
      <div className="flex gap-2 md:col-span-2"><button onClick={addIncident} className="bg-primary px-3 py-2 font-semibold text-primary-foreground" data-testid="button-submit-incident">Add incident</button><button onClick={() => setShowAdd(false)} className="border border-input px-3 py-2">Cancel</button></div>
    </div> : null}
    {saveError === 'conflict' ? <div className="border-t border-[hsl(39_92%_65%_/_0.55)] bg-[hsl(39_92%_65%_/_0.12)] p-4" role="alert" data-testid="notice-review-conflict">
      <div className="flex items-start gap-3">
        <CircleAlert size={17} className="mt-0.5 shrink-0 text-[hsl(30_69%_32%)]" />
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">This review was updated by someone else</div>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">Your save was not applied. Reload the newer review before continuing. Reloading will replace your unsaved local incident changes.</p>
          {reloadError ? <p className="mt-2 text-xs font-semibold leading-5 text-[hsl(5_69%_40%)]" data-testid="error-reload-review">The newer review could not be loaded. Your local incident changes are still here; try reloading again or continue with this draft.</p> : null}
          <div className="mt-3 flex flex-wrap gap-2">
            {confirmReload ? <>
              <button onClick={reloadCurrentReview} disabled={isReloading} className="inline-flex items-center gap-2 bg-[hsl(30_69%_32%)] px-3 py-2 text-xs font-semibold text-white disabled:opacity-50" data-testid="button-confirm-reload-review">{isReloading ? <Loader2 size={13} className="animate-spin" /> : null}Confirm reload and discard local changes</button>
              <button onClick={() => setConfirmReload(false)} disabled={isReloading} className="border border-input bg-card px-3 py-2 text-xs font-semibold" data-testid="button-cancel-reload-review">Keep local changes</button>
            </> : <button onClick={() => setConfirmReload(true)} className="border border-[hsl(30_69%_32%_/_0.45)] bg-card px-3 py-2 text-xs font-semibold text-[hsl(30_69%_32%)]" data-testid="button-reload-review">Reload newer review</button>}
          </div>
        </div>
      </div>
    </div> : null}
    {saveError === 'generic' ? <div className="flex items-center gap-2 border-t border-[hsl(5_69%_48%_/_0.22)] bg-[hsl(5_69%_48%_/_0.05)] px-4 py-3 text-xs text-[hsl(5_69%_40%)]" role="alert" data-testid="error-save-review"><CircleAlert size={14} />The review could not be saved. Your local changes are still here; try again.</div> : null}
    <div className="flex flex-wrap justify-between gap-3 border-t border-border p-4"><button onClick={() => { setShowAdd(true); setDraftEvidenceError(''); }} className="inline-flex items-center gap-2 border border-input px-3 py-2 font-semibold"><Plus size={14} />Add incident</button><div className="flex items-center gap-2">{hasIncompleteIncludedEvidence ? <span className="text-xs text-[hsl(5_69%_40%)]">Every included incident needs exact supporting text from each cited source before finalizing.</span> : null}<button onClick={() => save(false)} disabled={updateReview.isPending} className="border border-input px-3 py-2 font-semibold">Save review</button><button onClick={() => save(true)} disabled={updateReview.isPending || hasIncompleteIncludedEvidence || !hasSupportedAnswer} className="bg-[hsl(174_44%_32%)] px-3 py-2 font-semibold text-white disabled:opacity-45">{answer.finalized ? 'Finalized' : 'Finalize count'}</button></div></div>
  </div>;
}

function AssessmentSummary({ session, onUpdated }: { session: AnalysisSession; onUpdated: (session: AnalysisSession) => void }) {
  const assessment = session.assessment!;
  const gaps = assessment.standards.filter((standard) => standard.status !== 'PASS');

  return <section className="rise border border-[hsl(174_44%_43%_/_0.35)] bg-[hsl(174_44%_43%_/_0.06)] p-5 md:p-6" data-testid="panel-assessment-summary">
    <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-start">
      <div>
        <div className="section-kicker text-[hsl(174_44%_32%)]">{assessment.provisional ? "Provisional Assessment Complete" : "Assessment complete"}</div>
        <h2 className="display mt-1 text-2xl font-bold">A drafted judgment, ready for review.</h2>
      </div>
      <div className="flex items-center gap-3">
        <button onClick={() => downloadAnalyticReviewReport(session)} className="inline-flex items-center gap-2 border border-[hsl(174_44%_43%_/_0.45)] bg-card px-3 py-2 text-xs font-semibold text-[hsl(174_44%_32%)] hover:bg-muted" data-testid="button-download-analytic-review"><FileText size={14} />Download / print review</button>
        <div className="flex items-end gap-2">
        <span className="display text-4xl font-bold text-[hsl(174_44%_32%)]">{assessment.overallScore}</span>
        <span className="mono mb-1 text-[10px] uppercase text-muted-foreground">/ 100</span>
        </div>
      </div>
    </div>
    <p className="mt-4 max-w-3xl text-sm leading-6 text-foreground/80">{assessment.summary}</p>
    {assessment.countAnswer ? <CountAnswerReview session={session} onUpdated={onUpdated} /> : null}
    
    {assessment.methodology && (
      <div className="mt-4 border-l-2 border-[hsl(174_44%_43%_/_0.5)] pl-3 text-xs italic leading-5 text-muted-foreground max-w-3xl">
        <span className="font-semibold not-italic">Methodology:</span> {assessment.methodology}
      </div>
    )}

    <section className="mt-6 border border-[hsl(39_92%_65%_/_0.42)] bg-card p-4" data-testid="panel-assessment-gaps">
      <div className="section-kicker">Evidence gaps, assumptions & alternatives</div>
      <p className="mt-2 text-xs leading-5 text-muted-foreground">These are provisional review prompts drawn from the assessment findings. They are not unobserved facts.</p>
      {gaps.length ? <ul className="mt-3 space-y-2 text-sm leading-5 text-foreground/85">{gaps.map((standard) => <li className="border-l-2 border-[hsl(39_92%_65%)] pl-3" key={standard.id}><span className="font-semibold">{standard.shortName}:</span> {standard.finding}</li>)}</ul> : <p className="mt-3 text-sm text-muted-foreground">No structured gaps were generated. Review selected evidence and assumptions before release.</p>}
    </section>

    <div className="mt-8 border-t border-border/60 pt-6">
        <div className="section-kicker mb-2 text-foreground/80">Provisional ICD-203 Tradecraft Review</div>
        <p className="mb-4 text-xs leading-5 text-muted-foreground">These heuristic findings support analyst review; they are not a formal ICD-203 determination or release authority.</p>
      <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-5">
        {assessment.standards.map((standard) => (
          <div className="border border-border/70 bg-card/70 p-3" key={standard.id}>
            <div className="flex items-center justify-between">
              <span className="mono text-[10px] font-medium">{standard.shortName}</span>
              <span className="text-sm font-bold">{standard.score}</span>
            </div>
            <div className="mt-2 h-1 bg-secondary">
              <div className="h-full bg-[hsl(174_44%_43%)]" style={{ width: `${standard.score}%` }} />
            </div>
            <div className="mt-2"><StatusPill status={standard.status} /></div>
          </div>
        ))}
      </div>
    </div>

  </section>;
}

export function SessionsPage() {
  const sessionsQuery = useListAnalysisSessions();
  const [, setLocation] = useLocation();
  return <div className="space-y-7"><div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><div className="section-kicker">Production history</div><h1 className="display mt-2 text-3xl font-bold tracking-tight">Recent sessions</h1><p className="mt-2 text-sm text-muted-foreground">Every question, source run, and assessment stays attributable to its originating session.</p></div><Link href="/user-portal" className="inline-flex items-center gap-2 self-start bg-primary px-3.5 py-2.5 text-sm font-semibold text-primary-foreground" data-testid="link-new-session"><Plus size={15} /> New session</Link></div><div className="flex flex-wrap items-center gap-2 border-y border-border/70 py-3 text-xs text-muted-foreground"><Search size={14} /><span>Showing latest workspace activity</span><span className="ml-auto mono">{sessionsQuery.data?.length ?? 0} records</span></div>{sessionsQuery.isLoading ? <LoadingRows count={5} /> : sessionsQuery.error ? <div className="border border-[hsl(5_69%_48%_/_0.25)] bg-card p-6" data-testid="error-sessions"><CircleAlert className="text-[hsl(5_69%_48%)]" size={18} /><h3 className="mt-3 font-semibold">Sessions could not be loaded</h3><p className="mt-1 text-sm text-muted-foreground">The workspace history service did not respond. Retry from the browser when the API is available.</p></div> : sessionsQuery.data?.length ? <div className="overflow-x-auto border border-border bg-card"><table className="w-full min-w-[760px] text-left"><thead className="border-b border-border bg-muted/60"><tr className="mono text-[10px] uppercase tracking-[0.1em] text-muted-foreground"><th className="px-5 py-3 font-medium">Question</th><th className="px-4 py-3 font-medium">Analyst</th><th className="px-4 py-3 font-medium">Created</th><th className="px-4 py-3 font-medium">Sources</th><th className="px-4 py-3 font-medium">Status</th><th className="px-4 py-3" /></tr></thead><tbody>{sessionsQuery.data.map((item) => <tr className="border-b border-border/70 last:border-0 hover:bg-muted/35" key={item.id} data-testid={`row-session-${item.id}`}><td className="max-w-[430px] px-5 py-4"><div className="line-clamp-2 text-sm font-semibold text-foreground">{item.prompt}</div><div className="mono mt-1 text-[10px] text-muted-foreground">{item.classification}</div></td><td className="px-4 py-4 text-sm text-muted-foreground">{item.analyst}</td><td className="px-4 py-4 text-xs text-muted-foreground">{formatDateTime(item.createdAt)}</td><td className="px-4 py-4 mono text-xs text-muted-foreground">{item.sourceFiles.length.toString().padStart(2, '0')}</td><td className="px-4 py-4"><StatusPill status={item.status} /></td><td className="px-4 py-4 text-right"><button onClick={() => setLocation(`/user-portal?session=${item.id}`)} className="inline-flex items-center gap-1 text-xs font-semibold text-[hsl(174_44%_32%)] hover:underline" data-testid={`button-open-session-${item.id}`}>Open <ArrowUpRight size={13} /></button></td></tr>)}</tbody></table></div> : <EmptyState icon={Clock3} title="No analysis sessions yet" detail="Your completed and in-progress questions will appear here." action={<Link href="/user-portal" className="inline-flex items-center gap-2 bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground" data-testid="link-start-first-session"><Plus size={14} /> Start first session</Link>} />}</div>;
}

function StandardsPage() {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [expandedVector, setExpandedVector] = useState<string | null>(null);
  const vectorsQuery = useListEvaluationVectors();

  return <div className="space-y-10">
    <div>
      <div className="section-kicker">Review doctrine</div>
      <h1 className="display mt-2 text-3xl font-bold tracking-tight">Tradecraft standards & Vectors</h1>
      <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">Nine ICD-203 review lenses support disciplined production. Separate placeholder vectors are visible in the workbench before collection.</p>
    </div>

    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">ICD-203 Standards</h2>
        <p className="mt-1 text-sm text-muted-foreground">Analytic tradecraft standards applied to every assessment.</p>
      </div>
      <div className="grid gap-3 lg:grid-cols-2">{standards.map((standard, index) => <article className={`border bg-card transition-colors ${expanded === standard.id ? 'border-[hsl(39_92%_65%)]' : 'border-card-border'}`} key={standard.id} data-testid={`card-standard-${standard.id}`}><button onClick={() => setExpanded(expanded === standard.id ? null : standard.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left" data-testid={`button-expand-standard-${standard.id}`}><span className="mono text-xs text-muted-foreground">{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{standard.name}</span><span className="mono mt-1 block text-[10px] uppercase tracking-[0.09em] text-muted-foreground">{standard.shortName}</span></span><span className="grid h-7 w-7 place-items-center border border-border text-muted-foreground">{expanded === standard.id ? <X size={13} /> : <ChevronRight size={14} />}</span></button>{expanded === standard.id ? <div className="border-t border-border/70 bg-muted/35 px-5 pb-5 pt-4"><div className="section-kicker">Review guidance</div><p className="mt-2 text-sm leading-6 text-foreground/80">{standard.finding}</p><div className="mt-4 border-l-2 border-[hsl(39_92%_65%)] pl-3 text-xs italic leading-5 text-muted-foreground">{standard.prompt}</div></div> : null}</article>)}</div>
    </section>

    <section className="space-y-5">
      <div>
        <h2 className="text-xl font-bold">Placeholder Evaluation Vectors</h2>
        <p className="mt-1 text-sm text-muted-foreground">Metadata heuristics only; they do not evaluate report content or replace ICD-203 review.</p>
      </div>
      
      {vectorsQuery.isLoading ? <LoadingRows count={3} /> : vectorsQuery.error ? <EmptyState icon={CircleAlert} title="Vectors unavailable" detail="The evaluation vector registry could not be reached." /> : <div className="grid gap-3 lg:grid-cols-2">
        {vectorsQuery.data?.map((vector, index) => <article className={`border bg-card transition-colors ${expandedVector === vector.id ? 'border-[hsl(174_44%_43%)]' : 'border-card-border'}`} key={vector.id} data-testid={`card-vector-${vector.id}`}><button onClick={() => setExpandedVector(expandedVector === vector.id ? null : vector.id)} className="flex w-full items-center gap-4 px-5 py-4 text-left" data-testid={`button-expand-vector-${vector.id}`}><span className="mono text-xs text-muted-foreground">V{String(index + 1).padStart(2, '0')}</span><span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{vector.name}</span><span className="mono mt-1 block text-[10px] uppercase tracking-[0.09em] text-muted-foreground">Weight: {(vector.weight * 100).toFixed(0)}%</span></span><span className="grid h-7 w-7 place-items-center border border-border text-muted-foreground">{expandedVector === vector.id ? <X size={13} /> : <ChevronRight size={14} />}</span></button>{expandedVector === vector.id ? <div className="border-t border-border/70 bg-muted/35 px-5 pb-5 pt-4">
          <div className="flex items-center gap-2 mb-3">
            {vector.placeholder ? <span className="inline-flex items-center border border-[hsl(39_92%_65%_/_0.4)] bg-[hsl(39_92%_65%_/_0.1)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[hsl(30_69%_32%)]">PLACEHOLDER</span> : <span className="inline-flex items-center border border-[hsl(174_44%_43%_/_0.4)] bg-[hsl(174_44%_43%_/_0.1)] px-2 py-0.5 text-[10px] font-semibold tracking-[0.08em] text-[hsl(174_44%_32%)]">ACTIVE</span>}
          </div>
          <div className="section-kicker">Vector definition</div>
          <p className="mt-2 text-sm leading-6 text-foreground/80">{vector.description}</p>
        </div> : null}</article>)}
        {!vectorsQuery.data?.length ? <EmptyState icon={SlidersHorizontal} title="No evaluation vectors" detail="No active stand-in grading vectors are configured in this environment." /> : null}
      </div>}
    </section>

    <div className="border border-border bg-[hsl(222_38%_15%)] p-5 text-sidebar-foreground md:p-6"><div className="flex items-start gap-3"><ClipboardCheck size={18} className="mt-0.5 text-sidebar-primary" /><div><div className="section-kicker text-sidebar-foreground/55">In practice</div><p className="mt-2 max-w-2xl text-sm leading-6 text-sidebar-foreground/80">Standards are prompts for disciplined review, not a substitute for analyst judgment. A gap is a collection or reasoning task to resolve before release.</p></div></div></div>
  </div>;
}

function SettingsPage() {
  const connectorsQuery = useListSourceConnectors();
  const healthQuery = useHealthCheck();
  return <div className="space-y-7">
    <div>
      <div className="section-kicker">Workspace controls</div>
      <h1 className="display mt-2 text-3xl font-bold tracking-tight">Settings</h1>
      <p className="mt-2 text-sm text-muted-foreground">Review classification posture and source connector readiness. Configuration changes are managed by the workspace administrator.</p>
    </div>
    
    <div className="grid gap-5 lg:grid-cols-[0.8fr_1.2fr]">
      <div className="flex flex-col gap-5">
        <section className="border border-card-border bg-card p-5 md:p-6">
          <div className="flex items-center gap-3 border-b border-border/70 pb-4"><LockKeyhole size={18} className="text-[hsl(39_92%_48%)]" /><div><div className="text-sm font-semibold">Classification marking</div><div className="text-xs text-muted-foreground">Session provenance and public-collection control</div></div></div><div className="mt-4 border-l-2 border-[hsl(39_92%_65%)] pl-3 text-xs leading-5 text-muted-foreground">Markings do not classify text automatically and do not authorize classified handling. This development environment is not approved to store classified information.</div><div className="mt-5 space-y-3">{['UNCLASSIFIED', 'CUI', 'SECRET', 'TS'].map((level, index) => <div className={`flex items-center justify-between border p-3 ${index === 0 ? 'border-[hsl(39_92%_65%)] bg-[hsl(39_92%_65%_/_0.09)]' : 'border-border bg-muted/30 opacity-65'}`} key={level}><div><div className="mono text-xs font-medium">{level}</div><div className="mt-1 text-[11px] text-muted-foreground">{index === 0 ? 'Public connectors may be used' : 'Blocks public connectors; does not permit classified content'}</div></div>{index === 0 ? <Check size={15} className="text-[hsl(174_44%_43%)]" /> : <LockKeyhole size={13} className="text-muted-foreground" />}</div>)}</div>
        </section>
        <section className="border border-card-border bg-card p-5 md:p-6" data-testid="panel-settings-vectors">
          <div className="flex items-center gap-3 border-b border-border/70 pb-4"><SlidersHorizontal size={18} className="text-[hsl(174_44%_43%)]" /><div><div className="text-sm font-semibold">Evaluation Vectors</div><div className="text-xs text-muted-foreground">Stand-in grading criteria</div></div></div>
          <div className="mt-4 border-l-2 border-[hsl(39_92%_65%)] pl-3">
            <p className="text-sm font-medium leading-6 text-foreground/80">Placeholder vectors are unclassified substitutes.</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">Restricted criteria must be configured only in the approved target environment.</p>
          </div>
        </section>
      </div>

      <section className="border border-card-border bg-card p-5 md:p-6">
        <div className="flex items-center justify-between border-b border-border/70 pb-4"><div className="flex items-center gap-3"><Database size={18} className="text-[hsl(174_44%_43%)]" /><div><div className="text-sm font-semibold">Source connectors</div><div className="text-xs text-muted-foreground">Readiness is evaluated by the API</div></div></div><div className="flex items-center gap-2 text-xs text-muted-foreground"><span className={`h-1.5 w-1.5 ${healthQuery.data?.status === 'ok' ? 'bg-[hsl(174_44%_43%)]' : 'bg-[hsl(39_92%_65%)]'}`} />API {healthQuery.isLoading ? 'checking' : healthQuery.data?.status ?? 'unavailable'}</div></div>{connectorsQuery.isLoading ? <div className="mt-5"><LoadingRows count={3} /></div> : connectorsQuery.error ? <div className="mt-5"><EmptyState icon={CircleAlert} title="Readiness is unavailable" detail="The connector registry could not be reached. No connector is presented as ready." /></div> : <div className="mt-5 space-y-2">{connectorsQuery.data?.map((connector) => <div className="flex items-center gap-3 border border-border/75 p-3" key={connector.id} data-testid={`row-connector-${connector.id}`}><div className="grid h-8 w-8 place-items-center bg-muted text-muted-foreground"><Network size={15} /></div><div className="min-w-0 flex-1"><div className="text-sm font-semibold">{connector.name}</div><div className="mt-1 truncate text-xs text-muted-foreground">{connector.description}</div></div><StatusPill status={connector.status} /></div>)}{!connectorsQuery.data?.length ? <EmptyState icon={Network} title="No connectors configured" detail="There are no source adapters available to this workspace." /> : null}</div>}
      </section>
    </div>
  </div>;
}

function PortalRouter() {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}><AppShell><Switch><Route path="/user-portal" component={Home} /><Route path="/user-portal/sessions" component={SessionsPage} /><Route path="/user-portal/standards" component={StandardsPage} /><Route path="/user-portal/settings" component={SettingsPage} /><Route component={NotFound} /></Switch></AppShell></ErrorBoundary>;
}

function LandingPage() {
  return <main className="min-h-[100dvh] overflow-hidden bg-[hsl(222_38%_15%)] text-white">
    <div className="absolute inset-0 opacity-30 workbench-grid" />
    <div className="relative mx-auto flex min-h-[100dvh] max-w-6xl flex-col px-6 py-6 md:px-10">
      <header className="flex items-center justify-between border-b border-white/10 pb-5">
        <Link href="/" className="flex items-center gap-3" aria-label="Analyst Workbench home">
          <img src={`${basePath}/logo.svg`} className="h-9 w-9" alt="" />
          <span><span className="display block text-lg font-bold tracking-tight">Analyst Workbench</span><span className="mono block text-[9px] uppercase tracking-[0.16em] text-white/50">Evidence-led production</span></span>
        </Link>
        <div className="flex items-center gap-3">
          <Link href="/sign-in" className="px-3 py-2 text-sm font-semibold text-white/75 transition hover:text-white" data-testid="link-sign-in">Sign in</Link>
          <Link href="/sign-up" className="bg-[hsl(39_92%_65%)] px-4 py-2 text-sm font-bold text-[hsl(222_38%_15%)] transition hover:bg-[hsl(39_92%_72%)]" data-testid="link-sign-up">Request access</Link>
        </div>
      </header>
      <section className="grid flex-1 items-center gap-12 py-16 lg:grid-cols-[1.2fr_.8fr]">
        <div>
          <div className="mono inline-flex items-center gap-2 border border-[hsl(174_44%_52%_/_0.45)] bg-[hsl(174_44%_43%_/_0.12)] px-3 py-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[hsl(174_55%_68%)]"><ShieldCheck size={13} /> Analyst-controlled workflow</div>
          <h1 className="display mt-6 max-w-3xl text-5xl font-bold leading-[1.02] tracking-[-0.05em] md:text-6xl">Turn a bounded question into a reviewable assessment.</h1>
          <p className="mt-6 max-w-2xl text-lg leading-8 text-white/68">Analyst Workbench structures source collection, evidence selection, and ICD-203 tradecraft review so every provisional judgment stays traceable to its supporting material.</p>
          <div className="mt-8 flex flex-wrap gap-3">
            <Link href="/sign-up" className="inline-flex items-center gap-2 bg-[hsl(39_92%_65%)] px-5 py-3 text-sm font-bold text-[hsl(222_38%_15%)] transition hover:-translate-y-0.5" data-testid="link-landing-create-account">Create your account <ArrowUpRight size={16} /></Link>
            <Link href="/sign-in" className="inline-flex items-center gap-2 border border-white/20 px-5 py-3 text-sm font-semibold text-white transition hover:border-white/50">Continue to workspace <ChevronRight size={16} /></Link>
          </div>
          <p className="mono mt-6 text-[10px] uppercase tracking-[0.12em] text-white/42">UNCLASSIFIED / Internal workflow tool</p>
        </div>
        <div className="border border-white/12 bg-white/[0.055] p-5 shadow-2xl backdrop-blur md:p-7">
          <div className="flex items-center justify-between border-b border-white/10 pb-4"><span className="mono text-[10px] uppercase tracking-[0.14em] text-white/55">Production sequence</span><span className="h-2 w-2 bg-[hsl(174_44%_52%)]" /></div>
          {[['01', 'Frame the question', 'Set scope, decision need, and classification posture.'], ['02', 'Review evidence', 'Collect and select source-backed material.'], ['03', 'Assess & review', 'Make provisional judgments visible and challengeable.']].map(([number, title, detail]) => <div className="flex gap-4 border-b border-white/10 py-5 last:border-0" key={number}><span className="mono text-sm text-[hsl(39_92%_65%)]">{number}</span><div><h2 className="font-semibold text-white">{title}</h2><p className="mt-1 text-sm leading-6 text-white/55">{detail}</p></div></div>)}
        </div>
      </section>
      <footer className="flex flex-wrap justify-between gap-3 border-t border-white/10 pt-5 text-xs text-white/45"><span>Designed for disciplined analytic production.</span><span>Source-backed • Reviewable • Analyst accountable</span></footer>
    </div>
  </main>;
}

function SignInPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(222_24%_96%)] px-4"><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} /></div>;
}

function SignUpPage() {
  return <div className="flex min-h-[100dvh] items-center justify-center bg-[hsl(222_24%_96%)] px-4"><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`} /></div>;
}

function HomeRedirect() {
  const { isLoaded, isSignedIn } = useAuth();
  // The public product page must remain useful while Clerk initializes (for
  // example, on a slow first visit) rather than showing an empty viewport.
  if (!isLoaded || !isSignedIn) return <LandingPage />;
  return <Redirect to="/user-portal" />;
}

function ProtectedPortal() {
  const { isLoaded, isSignedIn } = useAuth();
  const { user } = useUser();
  if (!isLoaded) return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(222_24%_96%)]"><Loader2 className="animate-spin text-primary" aria-label="Loading workspace" /></div>;
  if (!isSignedIn) return <Redirect to="/" />;
  // A key forces all route and Home component state to remount if Clerk
  // changes account in this browser context.
  return <Show when="signed-in"><div key={user?.id ?? 'unknown-user'}><PortalRouter /></div></Show>;
}

function ClerkQueryClientCacheInvalidator() {
  const { addListener } = useClerk();
  const previousUserId = useRef<string | null | undefined>(undefined);
  useEffect(() => addListener(({ user }) => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== undefined && previousUserId.current !== userId) {
      void queryClient.cancelQueries();
      queryClient.clear();
    }
    previousUserId.current = userId;
  }), [addListener]);
  return null;
}

function ClerkProviderWithRoutes() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={clerkAppearance} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{ signIn: { start: { title: 'Welcome back', subtitle: 'Sign in to access your analyst workspace' } }, signUp: { start: { title: 'Create your analyst workspace', subtitle: 'Start an evidence-led assessment workflow' } } }} routerPush={(to) => setLocation(stripBase(to))} routerReplace={(to) => setLocation(stripBase(to), { replace: true })}><QueryClientProvider client={queryClient}><ClerkQueryClientCacheInvalidator /><TooltipProvider><Switch><Route path="/" component={HomeRedirect} /><Route path="/sign-in/*?" component={SignInPage} /><Route path="/sign-up/*?" component={SignUpPage} /><Route path="/user-portal/*?" component={ProtectedPortal} /><Route component={NotFound} /></Switch><Toaster /></TooltipProvider></QueryClientProvider></ClerkProvider>;
}

function App() {
  return <WouterRouter base={basePath}><ClerkProviderWithRoutes /></WouterRouter>;
}

export default App;
