import { useMemo, useState } from 'react'
import { ArrowUpRight, AlertTriangle, AlertOctagon, Clock, GitMerge, CheckCircle2, X } from 'lucide-react'
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
  fmtEastern,
  timeAgoShort,
} from '../lib/dashboard'

import { displayUser, isBotReviewer } from '../lib/utils'

interface Props {
  pullRequests: PullRequest[]
}

const STATUS_COLOR: Record<string, { stripe: string; pillBg: string; pillText: string }> = {
  failing: { stripe: '#d27a64', pillBg: 'rgba(210,122,100,0.14)', pillText: '#d27a64' },
  // Ready PR whose only "failure" is the backend-approval gate — not alarming, just informational.
  failing_be_approval: { stripe: '#7da3c4', pillBg: 'rgba(125,163,196,0.14)', pillText: '#7da3c4' },
  pending_be_review: { stripe: '#7da3c4', pillBg: 'rgba(125,163,196,0.14)', pillText: '#7da3c4' },
  changes_requested: { stripe: '#d4a14a', pillBg: 'rgba(212,161,74,0.14)', pillText: '#d4a14a' },
  // PR needs re-approval (new commits / dismissed approval after a BE approval) — amber, like changes_requested.
  needs_reapproval: { stripe: '#d4a14a', pillBg: 'rgba(212,161,74,0.14)', pillText: '#d4a14a' },
  ci_pending: { stripe: '#a89b78', pillBg: 'rgba(168,155,120,0.12)', pillText: '#a89b78' },
  approved: { stripe: '#9ab877', pillBg: 'rgba(154,184,119,0.14)', pillText: '#9ab877' },
  ready: { stripe: '#7da3c4', pillBg: 'rgba(125,163,196,0.14)', pillText: '#7da3c4' },
  draft: { stripe: '#8a8275', pillBg: 'rgba(138,130,117,0.10)', pillText: '#8a8275' },
  open: { stripe: '#8a8275', pillBg: 'rgba(138,130,117,0.10)', pillText: '#8a8275' },
}

function colorForHandle(handle: string) {
  let hash = 0
  for (let i = 0; i < handle.length; i++) hash = handle.charCodeAt(i) + ((hash << 5) - hash)
  const palette = [
    { bg: '#5d6e51', fg: '#e8eee0' },
    { bg: '#7a5d3f', fg: '#f1e8d8' },
    { bg: '#7d4f47', fg: '#f4e2dc' },
    { bg: '#4f6072', fg: '#e0e8f0' },
    { bg: '#766b3e', fg: '#efe9d0' },
    { bg: '#6b4e6b', fg: '#ece0ec' },
    { bg: '#3f6963', fg: '#dceee9' },
    { bg: '#8a5a3c', fg: '#f3e5d5' },
    { bg: '#54614a', fg: '#e7eadc' },
  ]
  return palette[Math.abs(hash) % palette.length]
}

export default function EditorialTerminal({ pullRequests }: Props) {
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
    <div className="design-isolated editorial-shell min-h-[calc(100vh-48px)] py-6">
      <EditorialStyle />

      <div className="mx-auto max-w-[1480px] px-5 sm:px-7">
        {/* Hero */}
        <section className="border-y border-[var(--ed-rule)] py-7 mb-6">
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr_auto] items-end gap-x-12 gap-y-5">
            <div>
              <div className="font-mono text-[16px] uppercase tracking-[0.24em] text-stone-500 mb-3">
                Awaiting your review
              </div>
              <div className="flex items-baseline gap-3">
                <span className="font-serif italic text-[88px] leading-[0.85] tabular-nums text-stone-100">
                  {counts.ready}
                </span>
                <span className="font-mono text-[16px] uppercase tracking-[0.18em] text-stone-500">
                  pull{counts.ready === 1 ? '' : 's'}
                </span>
              </div>
              {heroNames.length > 0 && (
                <div className="mt-4 font-mono text-[16px] text-stone-400">
                  next up:{' '}
                  <span className="text-stone-200">{heroNames.join(', ')}</span>
                </div>
              )}
            </div>

            <div className="hidden lg:block">
              <div className="font-mono text-[16px] uppercase tracking-[0.24em] text-stone-500 mb-3">
                Status board
              </div>
              <dl className="grid grid-cols-3 gap-x-6 gap-y-1.5 max-w-md font-mono text-[16px]">
                <Stat label="Failing CI" value={counts.failing} accent="#d27a64" />
                <Stat label="Approved" value={counts.approved} accent="#9ab877" />
                <Stat label="Awaiting" value={counts.awaiting} accent="#d4a14a" />
                <Stat label="Drafts" value={counts.drafts} />
                <Stat label="Dependabot" value={counts.dependabot} />
                <Stat label="All open" value={counts.all} />
              </dl>
            </div>

            <button
              onClick={() => setActiveFilter('ready')}
              className="self-end inline-flex items-center gap-2 font-mono text-[16px] uppercase tracking-[0.18em] text-stone-300 border-b border-stone-500 hover:text-stone-50 hover:border-stone-200 pb-1 transition-colors"
            >
              Open queue <ArrowUpRight className="h-3 w-3" />
            </button>
          </div>
        </section>

        {/* Filter rail */}
        <section className="mb-3 flex items-center gap-1 flex-wrap">
          {FILTERS.map(f => {
            const isActive = activeFilter === f.key
            return (
              <button
                key={f.key}
                onClick={() => setActiveFilter(f.key)}
                className={`group inline-flex items-baseline gap-1.5 px-2.5 py-1 font-mono text-[16px] uppercase tracking-[0.16em] transition-all ${
                  isActive ? 'text-stone-50' : 'text-stone-500 hover:text-stone-200'
                }`}
                style={{
                  borderBottom: isActive ? '1px solid #c9b486' : '1px solid transparent',
                }}
              >
                {f.label}
                <span className={`tabular-nums text-[16px] ${isActive ? 'text-stone-400' : 'text-stone-600'}`}>
                  {counts[f.key]}
                </span>
              </button>
            )
          })}
        </section>

        {/* Search */}
        <section className="mb-2 flex items-center gap-3 flex-wrap">
          <div className="relative flex-1 min-w-[240px] max-w-[460px]">
            <input
              type="text"
              placeholder="search title · author · repo · #number"
              value={searchTerm}
              onChange={e => setSearchTerm(e.target.value)}
              className="w-full bg-transparent border-b border-stone-800 focus:border-stone-500 px-1 py-1.5 font-mono text-xs text-stone-200 placeholder:text-stone-600 outline-none transition-colors"
            />
            {searchTerm && (
              <button
                onClick={() => setSearchTerm('')}
                className="absolute right-1 top-1/2 -translate-y-1/2 text-stone-600 hover:text-stone-300"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
          <span className="ml-auto font-mono text-[16px] uppercase tracking-[0.18em] text-stone-600 tabular-nums">
            {filtered.length} / {counts.all}
          </span>
        </section>

        {/* Table */}
        <section className="border-t border-[var(--ed-rule)]">
          <div className="grid grid-cols-[12px_1fr_220px_160px_140px] gap-x-4 px-3 py-2 border-b border-[var(--ed-rule)]">
            <span />
            <ColHead label="Pull request" />
            <ColHead label="Status" />
            <ColHead label="Reviewers" />
            <ColHead label="Activity" align="right" />
          </div>

          {filtered.length === 0 ? (
            <EmptyState filterKey={activeFilter} hasSearch={!!searchTerm} />
          ) : (
            filtered.map(pr => <PrRow key={pr.id} pr={pr} />)
          )}
        </section>
      </div>
    </div>
  )
}

function Stat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <>
      <dt className="text-stone-500">{label}</dt>
      <dd className="text-right tabular-nums" style={{ color: accent || '#c9c2b3' }}>
        {value}
      </dd>
      <dd />
    </>
  )
}

function ColHead({ label, align = 'left' }: { label: string; align?: 'left' | 'right' }) {
  return (
    <span
      className={`font-mono text-[16px] uppercase tracking-[0.24em] text-stone-600 ${align === 'right' ? 'text-right' : ''}`}
    >
      {label}
    </span>
  )
}

function PrRow({ pr }: { pr: PullRequest }) {
  const status = classifyStatus(pr)
  // Fall back to the neutral 'open' palette for any status key not explicitly
  // mapped, so a newly-added Status never crashes the gallery (e.g. reading
  // colors.stripe on undefined).
  const colors = STATUS_COLOR[status.key] ?? STATUS_COLOR.open
  const reviewers = reviewerBadgesFor(pr).filter(b => !isBotReviewer(b.user))
  const exempt = isTrulyExemptFromBackendReview(pr)
  const authorColor = colorForHandle(pr.author)
  const beApproved = pr.approval_summary?.approved_users?.some(u => BACKEND_REVIEWERS.includes(u))
  const cri = changesRequestedCell(pr)

  return (
    <button
      className="group w-full grid grid-cols-[12px_1fr_220px_160px_140px] items-start gap-x-4 px-3 py-3 border-b border-[var(--ed-rule-soft)] last:border-0 text-left hover:bg-[rgba(255,255,255,0.025)] transition-colors"
      onClick={() => window.open(pr.url, '_blank', 'noopener,noreferrer')}
    >
      <span className="self-stretch w-[3px] -my-3" style={{ backgroundColor: colors.stripe, opacity: 0.85 }} />

      <div className="min-w-0">
        <div className="flex items-center gap-2 mb-1">
          <span className="font-mono text-[16px] tabular-nums text-stone-500">#{pr.number}</span>
          {pr.repository_name && pr.repository_name !== 'vets-api' && (
            <span className="font-mono text-[16px] tracking-wide text-stone-500">{pr.repository_name}</span>
          )}
          {pr.draft && (
            <span className="font-mono text-[16px] uppercase tracking-[0.2em] text-stone-500 border border-stone-800 px-1 py-px">
              draft
            </span>
          )}
          {exempt && (
            <span className="font-mono text-[16px] uppercase tracking-[0.2em] text-[#9ab8a4] border border-[#3d5a4a] px-1 py-px">
              exempt
            </span>
          )}
        </div>
        <div className="font-serif text-[16px] leading-snug text-stone-100 group-hover:text-white truncate transition-colors">
          {pr.title}
        </div>
        <div className="flex items-center gap-2 mt-1.5">
          <span
            className="inline-flex h-[16px] w-[16px] items-center justify-center rounded-full text-[8px] font-mono font-medium"
            style={{ backgroundColor: authorColor.bg, color: authorColor.fg }}
          >
            {nameFromHandle(pr.author)}
          </span>
          <span className="font-mono text-[16px] text-stone-500 truncate">{displayUser(pr.author)}</span>
        </div>
      </div>

      <div className="flex flex-col gap-1.5 min-w-0">
        <span
          className="inline-flex items-center gap-1 self-start font-mono text-[12px] uppercase tracking-[0.16em] px-1.5 py-0.5 rounded-sm"
          style={{ backgroundColor: colors.pillBg, color: colors.pillText }}
        >
          {status.key === 'failing' && <AlertTriangle className="h-3 w-3" />}
          {status.key === 'changes_requested' && <AlertOctagon className="h-3 w-3" />}
          {status.key === 'ci_pending' && <Clock className="h-3 w-3" />}
          {status.key === 'approved' && <GitMerge className="h-3 w-3" />}
          {status.label}
        </span>
        {status.key === 'failing' && (
          <span className="font-mono text-[12px] text-stone-500 line-clamp-2">
            {summarizeFailingChecks(pr)}
          </span>
        )}
        {cri && (
          <span className="font-mono text-[11px] text-stone-500 truncate" title={cri.label}>
            {cri.label}
            {cri.when && <span className="text-stone-600"> · {cri.when}</span>}
          </span>
        )}
      </div>

      <div className="flex items-center gap-2 min-h-[22px]">
        <ReviewerStack badges={reviewers} approvedAt={pr.approval_summary?.approved_user_details} />
        {beApproved && (
          <span title="Backend reviewer approved" className="text-[#9ab877]">
            <CheckCircle2 className="h-3 w-3" />
          </span>
        )}
      </div>

      {(() => {
        const activity = summarizeActivity(pr, BACKEND_REVIEWERS)
        return (
          <div
            className="text-right font-mono text-[12px] leading-tight"
            title={`Created ${absoluteTime(pr.created_at)}\nUpdated ${absoluteTime(pr.updated_at)}`}
          >
            <div className="text-stone-200">{activity.latestLabel}</div>
            <div className="text-stone-500 mt-0.5 tabular-nums">{activity.latestTimeAgo}</div>
            {activity.rollup && (
              <div className="text-stone-600 mt-1 tabular-nums">{activity.rollup}</div>
            )}
            <div className="text-stone-700 mt-1 tabular-nums">opened {timeAgoShort(pr.created_at, ' ago')}</div>
          </div>
        )
      })()}
    </button>
  )
}

function ReviewerStack({
  badges,
  approvedAt,
}: {
  badges: { user: string; state: string }[]
  approvedAt?: { user: string; submitted_at: string }[]
}) {
  if (badges.length === 0) {
    return <span className="text-[16px] tracking-wide text-stone-600 font-mono">—</span>
  }
  const visible = badges.slice(0, 5)
  const overflow = badges.length - visible.length
  const approvedAtMap = new Map((approvedAt || []).map(d => [d.user, d.submitted_at]))
  return (
    <div className="flex -space-x-1.5 items-center">
      {visible.map(({ user, state }, i) => {
        const c = colorForHandle(user)
        const ringColor =
          state === 'approved'
            ? '#9ab877'
            : state === 'changes_requested'
              ? '#c97a64'
              : 'rgba(255,255,255,0.18)'
        const at = state === 'approved' ? approvedAtMap.get(user) : null
        return (
          <span
            key={user + state + i}
            className="relative inline-flex h-[22px] w-[22px] items-center justify-center rounded-full text-[16px] font-mono font-medium"
            style={{
              backgroundColor: c.bg,
              color: c.fg,
              boxShadow: `0 0 0 1.5px ${ringColor}, 0 0 0 3px var(--ed-bg)`,
            }}
            title={`${displayUser(user)} · ${state.replace('_', ' ')}${at ? ` · ${fmtEastern(at)}` : ''}`}
          >
            {nameFromHandle(user)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          className="inline-flex h-[22px] min-w-[22px] px-1 items-center justify-center rounded-full text-[16px] font-mono text-stone-400"
          style={{
            backgroundColor: 'rgba(255,255,255,0.04)',
            boxShadow: '0 0 0 1.5px rgba(255,255,255,0.10), 0 0 0 3px var(--ed-bg)',
          }}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

function EmptyState({ filterKey, hasSearch }: { filterKey: FilterKey; hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <div className="px-6 py-16 text-center">
        <div className="font-serif italic text-xl text-stone-300">No matches.</div>
        <div className="mt-2 font-mono text-[16px] uppercase tracking-[0.18em] text-stone-600">
          Try a different term
        </div>
      </div>
    )
  }
  const lines: Record<FilterKey, [string, string]> = {
    ready: ['All caught up.', 'No PRs are waiting on backend review.'],
    awaiting: ['Inbox zero.', 'Every reviewed PR has had a follow-up.'],
    failing: ['Green across the board.', 'No PRs have failing CI.'],
    drafts: ['No drafts in flight.', 'Nobody is mid-PR.'],
    dependabot: ['No automated PRs.', 'Dependabot has nothing open.'],
    approved: ['Nothing parked.', 'No backend-approved PRs sitting unmerged.'],
    team: ['No first reviews owed.', 'Every PR has had a team look.'],
    exempt: ['None exempt.', 'No PRs carry the exemption label.'],
    all: ['Empty queue.', 'All repositories are clear.'],
    devops: ['Nothing for DevOps.', 'No open PRs await vsp-operations.'],
  }
  const [title, sub] = lines[filterKey]
  return (
    <div className="px-6 py-20 text-center">
      <div className="font-serif italic text-2xl text-stone-200">{title}</div>
      <div className="mt-2 font-mono text-[16px] uppercase tracking-[0.18em] text-stone-500">{sub}</div>
    </div>
  )
}


function EditorialStyle() {
  return (
    <style>{`
      .editorial-shell {
        --ed-bg: #131311;
        --ed-rule: rgba(245,235,210,0.07);
        --ed-rule-soft: rgba(245,235,210,0.035);
        background-color: var(--ed-bg);
        color: #c9c2b3;
        background-image:
          radial-gradient(ellipse at top, rgba(201,180,134,0.04), transparent 60%),
          radial-gradient(ellipse at bottom right, rgba(125,163,196,0.025), transparent 60%);
      }
      .editorial-shell .font-serif {
        font-family: 'Fraunces', 'Iowan Old Style', Georgia, serif;
      }
      .editorial-shell .font-mono {
        font-family: 'JetBrains Mono', ui-monospace, SFMono-Regular, monospace;
      }
    `}</style>
  )
}
