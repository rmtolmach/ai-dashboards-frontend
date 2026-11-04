import { useMemo, useState } from 'react'
import {
  type PullRequest,
  BACKEND_REVIEWERS,
  isReadyForReview,
  isTrulyExemptFromBackendReview,
} from '../types/pull-request'
import {
  type FilterKey,
  FILTERS,
  classifyStatus,
  reviewerBadgesFor,
  absoluteTime,
  nameFromHandle,
  countByFilter,
  applyFilter,
  summarizeFailingChecks,
  summarizeActivity,
  changesRequestedCell,
  timeAgoShort,
} from '../lib/dashboard'

import { displayUser, isBotReviewer } from '../lib/utils'

interface Props {
  pullRequests: PullRequest[]
}

const STATUS_COLOR: Record<string, string> = {
  failing: '#ff5d5d',
  failing_be_approval: '#75c2ff',
  pending_be_review: '#75c2ff',
  changes_requested: '#ffb347',
  needs_reapproval: '#ffb347',
  ci_pending: '#bfbfa0',
  approved: '#7cd87c',
  ready: '#75c2ff',
  draft: '#7d8275',
  open: '#7d8275',
}

const STATUS_TAG: Record<string, string> = {
  failing: 'FAIL',
  failing_be_approval: 'BREQ',
  pending_be_review: 'BREV',
  changes_requested: 'CHGS',
  needs_reapproval: 'RAPP',
  ci_pending: 'CIRX',
  approved: 'APRV',
  ready: 'READ',
  draft: 'DRFT',
  open: 'OPEN',
}

export default function CrtConsole({ pullRequests }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ready')
  const [searchTerm, setSearchTerm] = useState('')

  const counts = useMemo(() => countByFilter(pullRequests), [pullRequests])
  const filtered = useMemo(
    () => applyFilter(pullRequests, activeFilter, searchTerm),
    [pullRequests, activeFilter, searchTerm]
  )
  const heroNames = useMemo(
    () =>
      pullRequests
        .filter(isReadyForReview)
        .slice(0, 3)
        .map(pr => displayUser(pr.author)),
    [pullRequests]
  )

  return (
    <div className="design-isolated crt-shell min-h-[calc(100vh-48px)] relative">
      <CrtStyle />
      <div className="crt-scanlines" />
      <div className="crt-vignette" />

      <div className="relative mx-auto max-w-[1480px] px-6 py-6">
        {/* Boot line */}
        <div className="text-[16px] mb-3 opacity-70">
          <span className="text-[var(--crt-amber)]">[OK]</span> session established · va.ghe.com · pr-control v6.0
        </div>

        {/* Hero panel */}
        <section className="crt-panel p-5 mb-5">
          <div className="flex items-center justify-between mb-3 text-[16px] tracking-[0.18em] uppercase opacity-70">
            <span>// review_queue.dat</span>
            <span>cnt={String(counts.ready).padStart(3, '0')}</span>
          </div>
          <div className="grid grid-cols-12 gap-4">
            <div className="col-span-12 md:col-span-7 border-r border-[var(--crt-rule)] pr-6">
              <div className="text-[16px] tracking-[0.2em] uppercase mb-2 text-[var(--crt-amber)]">
                ▎awaiting your review
              </div>
              <div className="flex items-baseline gap-3">
                <span
                  className="text-[110px] leading-[0.88] tabular-nums"
                  style={{
                    color: 'var(--crt-green)',
                    textShadow: '0 0 8px rgba(124,216,124,0.6), 0 0 18px rgba(124,216,124,0.3)',
                  }}
                >
                  {String(counts.ready).padStart(2, '0')}
                </span>
                <div className="text-[16px] opacity-80">
                  <div>pull requests</div>
                  <div className="opacity-60">awaiting backend reviewer</div>
                </div>
              </div>
              {heroNames.length > 0 && (
                <div className="mt-4 text-[16px] opacity-80">
                  &gt; next:{' '}
                  <span className="text-[var(--crt-amber)]">
                    {heroNames.map(n => n.toUpperCase()).join(', ')}
                  </span>
                </div>
              )}
            </div>

            <div className="col-span-12 md:col-span-5 pl-6 grid grid-cols-2 gap-y-2 gap-x-5 content-start text-[16px] tabular-nums">
              <CrtStat label="FAIL" value={counts.failing} color="#ff5d5d" />
              <CrtStat label="APRV" value={counts.approved} color="#7cd87c" />
              <CrtStat label="CHGS" value={counts.awaiting} color="#ffb347" />
              <CrtStat label="DRFT" value={counts.drafts} />
              <CrtStat label="DEPB" value={counts.dependabot} />
              <CrtStat label="OPEN" value={counts.all} />
            </div>
          </div>
        </section>

        {/* Filters */}
        <section className="mb-3 text-[16px] uppercase tracking-[0.16em] flex flex-wrap items-center gap-x-1 gap-y-1">
          <span className="opacity-60 mr-2">FILTER:</span>
          {FILTERS.map((f, i) => {
            const isActive = activeFilter === f.key
            return (
              <span key={f.key} className="flex items-center">
                {i > 0 && <span className="opacity-40 mx-1">|</span>}
                <button
                  onClick={() => setActiveFilter(f.key)}
                  className="transition-colors"
                  style={{
                    color: isActive ? 'var(--crt-amber)' : 'inherit',
                    textShadow: isActive ? '0 0 6px rgba(255,179,71,0.6)' : 'none',
                  }}
                >
                  [{isActive ? '*' : ' '}] {f.label.replace(' · ', '/')}{' '}
                  <span className="opacity-60 tabular-nums">{counts[f.key]}</span>
                </button>
              </span>
            )
          })}
        </section>

        {/* Search */}
        <div className="mb-3 flex items-baseline gap-2 border-b border-[var(--crt-rule)] pb-2 text-[16px]">
          <span className="opacity-70">$</span>
          <span className="text-[var(--crt-amber)]">grep</span>
          <input
            type="text"
            placeholder="title · author · repo · #number"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="flex-1 bg-transparent outline-none placeholder:opacity-40"
            spellCheck={false}
          />
          <span className="opacity-60 tabular-nums text-[16px]">
            [{String(filtered.length).padStart(3, '0')}/{String(counts.all).padStart(3, '0')}]
          </span>
        </div>

        {/* Listing */}
        <section className="crt-panel">
          {/* Header bar */}
          <div className="grid grid-cols-[42px_1fr_120px_180px_120px] gap-x-3 px-4 py-2 border-b border-[var(--crt-rule)] text-[16px] uppercase tracking-[0.22em] opacity-70">
            <span>idx</span>
            <span>pull request</span>
            <span>status</span>
            <span>reviewers</span>
            <span className="text-right">activity</span>
          </div>

          {filtered.length === 0 ? (
            <CrtEmpty filterKey={activeFilter} hasSearch={!!searchTerm} />
          ) : (
            filtered.map((pr, idx) => <CrtRow key={pr.id} pr={pr} idx={idx + 1} />)
          )}
        </section>

        <div className="mt-4 text-[16px] opacity-60 text-center tracking-[0.18em] uppercase">
          {filtered.length === 0 ? '// end of buffer' : `// rendered ${filtered.length} record${filtered.length === 1 ? '' : 's'}`}
        </div>
      </div>
    </div>
  )
}

function CrtStat({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <>
      <span className="opacity-70">{label}</span>
      <span className="text-right tabular-nums" style={color ? { color } : {}}>
        {String(value).padStart(3, '0')}
      </span>
    </>
  )
}

function CrtRow({ pr, idx }: { pr: PullRequest; idx: number }) {
  const status = classifyStatus(pr)
  const color = STATUS_COLOR[status.key]
  const reviewers = reviewerBadgesFor(pr).filter(b => !isBotReviewer(b.user))
  const exempt = isTrulyExemptFromBackendReview(pr)
  const beApproved = pr.approval_summary?.approved_users?.some(u => BACKEND_REVIEWERS.includes(u))
  const approvedAtMap = new Map(
    (pr.approval_summary?.approved_user_details || []).map(d => [d.user, d.submitted_at])
  )
  const cri = changesRequestedCell(pr)

  return (
    <button
      className="group w-full grid grid-cols-[42px_1fr_120px_180px_120px] items-start gap-x-3 px-4 py-2.5 border-b border-[var(--crt-rule-soft)] last:border-0 text-left text-[16px] hover:bg-[rgba(124,216,124,0.04)] transition-colors"
      onClick={() => window.open(pr.url, '_blank', 'noopener,noreferrer')}
    >
      <span className="tabular-nums opacity-50">{String(idx).padStart(3, '0')}</span>

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-0.5 text-[16px] uppercase tracking-[0.16em] opacity-70">
          <span>#{pr.number}</span>
          {pr.repository_name && pr.repository_name !== 'vets-api' && (
            <>
              <span>·</span>
              <span>{pr.repository_name}</span>
            </>
          )}
          {pr.draft && <span className="text-[var(--crt-amber)]">· DRAFT</span>}
          {exempt && <span style={{ color: '#9ad6c4' }}>· EXEMPT</span>}
        </div>
        <div className="truncate text-[16px] leading-snug">
          <span style={{ color: 'var(--crt-green)' }}>›</span> {pr.title}
        </div>
        <div className="mt-0.5 text-[16px] opacity-70">
          {displayUser(pr.author).toLowerCase()}
        </div>
      </div>

      <div className="flex flex-col gap-0.5 min-w-0">
        <span className="text-[12px] tabular-nums" style={{ color }}>
          [{STATUS_TAG[status.key] || 'OPEN'}] {status.label}
        </span>
        {status.key === 'failing' && (
          <span className="text-[11px] opacity-70 line-clamp-2">
            {summarizeFailingChecks(pr)}
          </span>
        )}
        {cri && (
          <span className="text-[11px] opacity-60 line-clamp-2" title={cri.label}>
            {cri.label.toLowerCase()}
            {cri.when && ` · ${cri.when}`}
          </span>
        )}
      </div>

      <div className="flex items-center gap-1.5 flex-wrap min-h-[20px] text-[16px] tracking-wide">
        {reviewers.length === 0 ? (
          <span className="opacity-40">—</span>
        ) : (
          reviewers.slice(0, 3).map(({ user, state }) => {
            const c =
              state === 'approved' ? '#7cd87c' : state === 'changes_requested' ? '#ff5d5d' : 'inherit'
            const at = state === 'approved' ? approvedAtMap.get(user) : null
            return (
              <span
                key={user + state}
                style={{ color: c }}
                className="inline-flex items-center"
                title={`${displayUser(user)} · ${state.replace('_', ' ')}${at ? ` · ${absoluteTime(at)}` : ''}`}
              >
                {nameFromHandle(user)}
              </span>
            )
          })
        )}
        {reviewers.length > 3 && (
          <span className="opacity-50">+{reviewers.length - 3}</span>
        )}
        {beApproved && (
          <span className="px-1 py-px" style={{ color: '#0a0a0a', backgroundColor: '#7cd87c' }}>
            BE
          </span>
        )}
      </div>

      {(() => {
        const activity = summarizeActivity(pr, BACKEND_REVIEWERS)
        return (
          <div
            className="text-right text-[12px] leading-tight tracking-wide"
            title={`Updated ${absoluteTime(pr.updated_at)}\nCreated ${absoluteTime(pr.created_at)}`}
          >
            <div className="opacity-90 truncate">{activity.latestLabel.toLowerCase()}</div>
            <div className="opacity-60 tabular-nums">{activity.latestTimeAgo}</div>
            {activity.rollup && (
              <div className="opacity-40 tabular-nums">{activity.rollup.toLowerCase()}</div>
            )}
            <div className="opacity-30 tabular-nums">opened {timeAgoShort(pr.created_at, ' ago')}</div>
          </div>
        )
      })()}
    </button>
  )
}

function CrtEmpty({ filterKey, hasSearch }: { filterKey: FilterKey; hasSearch: boolean }) {
  const ascii = `
   _   _  ___  _____ _   _ ___ _   _  ___
  | \\ | |/ _ \\|_   _| | | |_ _| \\ | |/ _ \\
  |  \\| | | | | | | | |_| || ||  \\| | | | |
  | |\\  | |_| | | | |  _  || || |\\  | |_| |
  |_| \\_|\\___/  |_| |_| |_|___|_| \\_|\\___/
  `
  if (hasSearch) {
    return (
      <div className="px-6 py-12 text-center text-[16px]">
        <pre className="text-[var(--crt-amber)] opacity-80 inline-block text-left">{ascii}</pre>
        <div className="mt-3 opacity-70">no records match query.</div>
      </div>
    )
  }
  const lines: Record<FilterKey, string> = {
    ready: '> queue is empty. all caught up.',
    awaiting: '> no follow-ups pending.',
    failing: '> all green.',
    drafts: '> no drafts.',
    dependabot: '> dependabot quiet.',
    approved: '> no parked approvals.',
    team: '> no first reviews owed.',
    exempt: '> none exempt.',
    all: '> repositories clear.',
    devops: '> nothing awaiting devops.',
  }
  return (
    <div className="px-6 py-12 text-center text-[16px]">
      <pre className="text-[var(--crt-green)] opacity-70 inline-block text-left">{ascii}</pre>
      <div className="mt-3">{lines[filterKey]}</div>
    </div>
  )
}


function CrtStyle() {
  return (
    <style>{`
      .crt-shell {
        --crt-bg: #0c1410;
        --crt-fg: #b8e8b8;
        --crt-green: #7cd87c;
        --crt-amber: #ffb347;
        --crt-rule: rgba(124,216,124,0.18);
        --crt-rule-soft: rgba(124,216,124,0.08);
        background-color: var(--crt-bg);
        color: var(--crt-fg);
        background-image:
          radial-gradient(ellipse at center, rgba(124,216,124,0.04) 0%, transparent 75%);
      }
      .crt-shell * {
        font-family: 'JetBrains Mono', 'IBM Plex Mono', ui-monospace, SFMono-Regular, monospace;
      }
      .crt-shell .crt-panel {
        border: 1px solid var(--crt-rule);
        background:
          linear-gradient(180deg, rgba(124,216,124,0.025), transparent 30%),
          rgba(255,255,255,0.012);
      }
      .crt-shell .crt-scanlines {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background-image: repeating-linear-gradient(
          0deg,
          rgba(0,0,0,0.18) 0,
          rgba(0,0,0,0.18) 1px,
          transparent 1px,
          transparent 3px
        );
        z-index: 1;
        opacity: 0.55;
      }
      .crt-shell .crt-vignette {
        position: fixed;
        inset: 0;
        pointer-events: none;
        background: radial-gradient(ellipse at center, transparent 55%, rgba(0,0,0,0.65) 100%);
        z-index: 1;
      }
    `}</style>
  )
}
