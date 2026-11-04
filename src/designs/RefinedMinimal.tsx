import { useMemo, useState } from 'react'
import {
  type PullRequest,
  BACKEND_REVIEWERS,
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

const STATUS_DOT: Record<string, string> = {
  failing: '#dc2626',
  failing_be_approval: '#1d4ed8',
  pending_be_review: '#1d4ed8',
  changes_requested: '#d97706',
  needs_reapproval: '#d97706',
  ci_pending: '#a3a3a3',
  approved: '#16a34a',
  ready: '#1d4ed8',
  draft: '#a3a3a3',
  open: '#a3a3a3',
}

export default function RefinedMinimal({ pullRequests }: Props) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('ready')
  const [searchTerm, setSearchTerm] = useState('')

  const counts = useMemo(() => countByFilter(pullRequests), [pullRequests])
  const filtered = useMemo(
    () => applyFilter(pullRequests, activeFilter, searchTerm),
    [pullRequests, activeFilter, searchTerm]
  )
  // Number of PRs that saw any reviewer activity today. Uses
  // latest_reviewer_activity, which is one event per PR — so this counts
  // PRs touched, not total events. Splitting by event type is misleading
  // because a PR with both a review and a comment today would only show
  // its most recent activity.
  const prsActiveToday = useMemo(() => {
    const startOfDay = new Date()
    startOfDay.setHours(0, 0, 0, 0)
    return pullRequests.filter(pr => {
      const ts = pr.latest_reviewer_activity?.timestamp
      return ts && new Date(ts) >= startOfDay
    }).length
  }, [pullRequests])

  return (
    <div className="design-isolated refined-shell min-h-[calc(100vh-48px)]">
      <RefinedStyle />

      <div className="mx-auto max-w-[1280px] px-8 py-12">
        {/* Hero — generous whitespace, single statement */}
        <section className="mb-16 grid grid-cols-12 gap-6">
          <div className="col-span-12 md:col-span-7">
            <div className="font-mono text-[16px] tracking-[0.18em] text-neutral-500 uppercase mb-6">
              Awaiting your review
            </div>
            <div className="flex items-baseline gap-4">
              <span className="font-display text-[120px] leading-[0.85] tracking-[-0.04em] text-neutral-900 tabular-nums">
                {counts.ready}
              </span>
              <div className="flex flex-col">
                <span className="font-display text-[24px] leading-tight text-neutral-700">
                  pull request{counts.ready === 1 ? '' : 's'}
                </span>
                <span className="font-display text-[24px] leading-tight text-neutral-400">
                  ready to review
                </span>
              </div>
            </div>
            {prsActiveToday > 0 && (
              <div className="mt-8 font-mono text-[16px] text-neutral-500">
                Active today:{' '}
                <span className="text-neutral-900">
                  {prsActiveToday} PR{prsActiveToday === 1 ? '' : 's'}
                </span>
              </div>
            )}
          </div>

          <div className="col-span-12 md:col-span-5 md:pl-8 md:border-l border-neutral-200">
            <div className="font-mono text-[16px] tracking-[0.18em] text-neutral-500 uppercase mb-6">
              Open backlog
            </div>
            <dl className="grid grid-cols-2 gap-y-3 font-mono text-[16px]">
              <RefinedStat label="Failing CI" value={counts.failing} accent="#dc2626" />
              <RefinedStat label="Approved" value={counts.approved} accent="#16a34a" />
              <RefinedStat label="Awaiting author" value={counts.awaiting} accent="#d97706" />
              <RefinedStat label="Drafts" value={counts.drafts} />
              <RefinedStat label="Dependabot" value={counts.dependabot} />
              <RefinedStat label="All open" value={counts.all} />
            </dl>
          </div>
        </section>

        {/* Filter rail — minimal text-only */}
        <nav className="border-b border-neutral-200 mb-8">
          <div className="flex items-center gap-6 flex-wrap pb-3">
            {FILTERS.map(f => {
              const isActive = activeFilter === f.key
              return (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  className={`group relative font-display text-[16px] tracking-tight transition-colors ${
                    isActive ? 'text-neutral-900' : 'text-neutral-400 hover:text-neutral-700'
                  }`}
                >
                  {f.label}
                  <span className="ml-1.5 font-mono text-[16px] tabular-nums opacity-70">{counts[f.key]}</span>
                  {isActive && (
                    <span className="absolute -bottom-3 left-0 right-0 h-px bg-neutral-900" />
                  )}
                </button>
              )
            })}
          </div>
        </nav>

        {/* Search */}
        <div className="mb-6 flex items-center gap-4">
          <input
            type="text"
            placeholder="Search pull requests"
            value={searchTerm}
            onChange={e => setSearchTerm(e.target.value)}
            className="flex-1 max-w-md bg-transparent border-b border-neutral-200 focus:border-neutral-900 px-1 py-2 font-display text-[16px] text-neutral-900 placeholder:text-neutral-400 outline-none transition-colors"
          />
          <span className="font-mono text-[16px] text-neutral-500 tabular-nums">
            {filtered.length} of {counts.all}
          </span>
        </div>

        {/* List — no borders, just generous spacing */}
        <section>
          {filtered.length === 0 ? (
            <RefinedEmpty filterKey={activeFilter} hasSearch={!!searchTerm} />
          ) : (
            <ul className="divide-y divide-neutral-200">
              {filtered.map(pr => (
                <RefinedRow key={pr.id} pr={pr} />
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  )
}

function RefinedStat({ label, value, accent }: { label: string; value: number; accent?: string }) {
  return (
    <>
      <dt className="text-neutral-500">{label}</dt>
      <dd
        className="text-right font-display tabular-nums text-[16px]"
        style={{ color: accent || '#171717' }}
      >
        {value}
      </dd>
    </>
  )
}

function RefinedRow({ pr }: { pr: PullRequest }) {
  const status = classifyStatus(pr)
  const reviewers = reviewerBadgesFor(pr).filter(b => !isBotReviewer(b.user))
  const exempt = isTrulyExemptFromBackendReview(pr)
  const beApproved = pr.approval_summary?.approved_users?.some(u => BACKEND_REVIEWERS.includes(u))
  const cri = changesRequestedCell(pr)

  return (
    <li>
      <button
        className="group w-full grid grid-cols-[1fr_auto_auto] items-start gap-x-8 py-6 text-left hover:bg-neutral-50 transition-colors -mx-3 px-3"
        onClick={() => window.open(pr.url, '_blank', 'noopener,noreferrer')}
      >
        <div className="min-w-0">
          <div className="flex items-center gap-3 mb-1">
            <span
              className="inline-block h-1.5 w-1.5 rounded-full shrink-0"
              style={{ backgroundColor: STATUS_DOT[status.key] }}
            />
            <span className="font-mono text-[16px] uppercase tracking-[0.14em] text-neutral-500">
              {status.label}
            </span>
            <span className="font-mono text-[16px] tabular-nums text-neutral-400">
              · {pr.repository_name && pr.repository_name !== 'vets-api' ? `${pr.repository_name} ` : ''}#{pr.number}
            </span>
            {pr.draft && (
              <span className="font-mono text-[16px] uppercase tracking-[0.16em] text-neutral-400">
                · draft
              </span>
            )}
            {exempt && (
              <span className="font-mono text-[16px] uppercase tracking-[0.16em] text-neutral-400">
                · exempt
              </span>
            )}
          </div>
          <div className="font-display text-[18px] leading-snug text-neutral-900 group-hover:text-black truncate transition-colors">
            {pr.title}
          </div>
          <div className="mt-1.5 font-mono text-[12px] text-neutral-500">
            {displayUser(pr.author)}
            {status.key === 'failing' && (
              <span className="text-neutral-400"> — {summarizeFailingChecks(pr)}</span>
            )}
            {cri && (
              <span className="text-neutral-400">
                {' '}
                — {cri.label}
                {cri.when && ` · ${cri.when}`}
              </span>
            )}
          </div>
        </div>

        <div className="flex items-center gap-3 self-center">
          <RefinedReviewerStack badges={reviewers} approvedAt={pr.approval_summary?.approved_user_details} />
          {beApproved && (
            <span
              className="font-mono text-[16px] uppercase tracking-[0.2em] px-1.5 py-0.5 rounded-sm"
              style={{ color: '#16a34a', backgroundColor: 'rgba(22,163,74,0.08)' }}
              title="Backend approved"
            >
              BE
            </span>
          )}
        </div>

        {(() => {
          const activity = summarizeActivity(pr, BACKEND_REVIEWERS)
          return (
            <div
              className="text-right font-mono text-[12px] leading-tight self-center"
              title={`Updated ${absoluteTime(pr.updated_at)}\nCreated ${absoluteTime(pr.created_at)}`}
            >
              <div className="text-neutral-700">{activity.latestLabel}</div>
              <div className="text-neutral-400 mt-0.5 tabular-nums">{activity.latestTimeAgo}</div>
              {activity.rollup && (
                <div className="text-neutral-400 mt-0.5 tabular-nums">{activity.rollup}</div>
              )}
              <div className="text-neutral-300 mt-0.5 tabular-nums">opened {timeAgoShort(pr.created_at, ' ago')}</div>
            </div>
          )
        })()}
      </button>
    </li>
  )
}

function RefinedReviewerStack({
  badges,
  approvedAt,
}: {
  badges: { user: string; state: string }[]
  approvedAt?: { user: string; submitted_at: string }[]
}) {
  if (badges.length === 0) {
    return <span className="font-mono text-[16px] text-neutral-400">—</span>
  }
  const visible = badges.slice(0, 4)
  const overflow = badges.length - visible.length
  const approvedAtMap = new Map((approvedAt || []).map(d => [d.user, d.submitted_at]))
  return (
    <div className="flex -space-x-1.5 items-center">
      {visible.map(({ user, state }, i) => {
        const ringColor =
          state === 'approved'
            ? '#16a34a'
            : state === 'changes_requested'
              ? '#dc2626'
              : '#d4d4d4'
        const at = state === 'approved' ? approvedAtMap.get(user) : null
        return (
          <span
            key={user + state + i}
            className="relative inline-flex h-[24px] w-[24px] items-center justify-center rounded-full text-[16px] font-mono font-medium text-neutral-700 bg-neutral-100"
            style={{ boxShadow: `0 0 0 1.5px ${ringColor}, 0 0 0 3px white` }}
            title={`${displayUser(user)} · ${state.replace('_', ' ')}${at ? ` · ${absoluteTime(at)}` : ''}`}
          >
            {nameFromHandle(user)}
          </span>
        )
      })}
      {overflow > 0 && (
        <span
          className="inline-flex h-[24px] min-w-[24px] px-1 items-center justify-center rounded-full text-[16px] font-mono text-neutral-500 bg-neutral-100"
          style={{ boxShadow: '0 0 0 1.5px #d4d4d4, 0 0 0 3px white' }}
        >
          +{overflow}
        </span>
      )}
    </div>
  )
}

function RefinedEmpty({ filterKey, hasSearch }: { filterKey: FilterKey; hasSearch: boolean }) {
  if (hasSearch) {
    return (
      <div className="py-24 text-center">
        <div className="font-display text-[28px] tracking-tight text-neutral-900">No matches</div>
        <div className="mt-2 font-mono text-[16px] text-neutral-500">Try a different term</div>
      </div>
    )
  }
  const lines: Record<FilterKey, [string, string]> = {
    ready: ['All caught up', 'No PRs are waiting on backend review.'],
    awaiting: ['Inbox zero', 'Every reviewed PR has had a follow-up.'],
    failing: ['All green', 'No PRs have failing CI.'],
    drafts: ['No drafts', 'Nobody is mid-PR.'],
    dependabot: ['Quiet', 'Dependabot has nothing open.'],
    approved: ['Nothing parked', 'No backend-approved PRs sitting unmerged.'],
    team: ['No first reviews owed', 'Every PR has had a team look.'],
    exempt: ['None exempt', 'No PRs carry the exemption label.'],
    all: ['Empty queue', 'All repositories are clear.'],
    devops: ['Nothing for DevOps', 'No open PRs await vsp-operations.'],
  }
  const [title, sub] = lines[filterKey]
  return (
    <div className="py-24 text-center">
      <div className="font-display text-[40px] tracking-tight text-neutral-900">{title}</div>
      <div className="mt-3 font-mono text-[16px] text-neutral-500">{sub}</div>
    </div>
  )
}


function RefinedStyle() {
  return (
    <style>{`
      .refined-shell {
        background-color: #ffffff;
        color: #171717;
      }
      .refined-shell .font-display {
        font-family: 'Söhne', 'Inter Display', 'Helvetica Neue', sans-serif;
        font-weight: 500;
        letter-spacing: -0.005em;
      }
      .refined-shell .font-mono {
        font-family: 'GT America Mono', 'JetBrains Mono', ui-monospace, monospace;
      }

      /* Explicit color cascade — Tailwind v4 + shadcn break inheritance,
         so set color on every text-bearing element. Tailwind text-* utility
         classes still win because they have the same specificity but higher
         declared order in the bundle, AND they declare a color directly. */
      .refined-shell,
      .refined-shell div,
      .refined-shell span,
      .refined-shell p,
      .refined-shell h1,
      .refined-shell h2,
      .refined-shell h3,
      .refined-shell button,
      .refined-shell a,
      .refined-shell li,
      .refined-shell dt,
      .refined-shell dd {
        color: #171717;
      }
      /* Tailwind utilities for muted/light shades on neutrals must still
         win — restate them with the same specificity so they survive. */
      .refined-shell .text-neutral-900 { color: #171717; }
      .refined-shell .text-neutral-700 { color: #404040; }
      .refined-shell .text-neutral-500 { color: #737373; }
      .refined-shell .text-neutral-400 { color: #a3a3a3; }
      .refined-shell .text-neutral-300 { color: #d4d4d4; }
      .refined-shell .text-black { color: #000000; }
      .refined-shell input { color: #171717; background-color: transparent; }
      .refined-shell input::placeholder { color: #a3a3a3; }
    `}</style>
  )
}
