import { useMemo, useState } from 'react'
import { type PullRequest } from '../types/pull-request'
import {
  type FilterKey,
  type Status,
  FILTERS,
  classifyStatus,
  absoluteTime,
  countByFilter,
  applyFilter,
  summarizeFailingChecksCompact,
  timeAgoShort,
} from '../lib/dashboard'

import { displayUser } from '../lib/utils'

interface Props {
  pullRequests: PullRequest[]
}

// ── Triage Board ────────────────────────────────────────────────────────────
// Design thesis: color is state, not decoration — one violet accent (the
// selected queue and the table rail, nothing else), red only for genuinely
// broken CI, green for approvals, amber for waiting-on-review states.
//
// Type carries hierarchy instead of gray: everything is white, differentiated
// by size and weight (per Ryan, 2026-08-20 — the gray ramp was unreadable).
// Primary = 14px/500, secondary = 12px/400 at full white, labels = 11px caps.
//
// Feature parity with /dashboard is a requirement, not a goal: every bucket,
// sortable columns, Open All, changes-requested detail with ET timestamps,
// commented-by, and created dates all exist here — only the presentation is
// condensed (8 fixed columns, title takes the slack, no horizontal scroll).

const T = {
  bg: '#0B0E14',
  surface: '#11151D',
  line: 'rgba(148,163,184,0.14)',
  text: '#FFFFFF',
  accent: '#8B7CF6',
  accentDim: 'rgba(139,124,246,0.14)',
  red: '#F87171',
  green: '#4ADE80',
  amber: '#FBBF24',
}

// All-white type roles. Hierarchy comes from size/weight alone.
const type = {
  primary: { color: T.text, fontSize: 14, fontWeight: 500 } as const,
  secondary: { color: T.text, fontSize: 12, fontWeight: 400 } as const,
  label: { color: T.text, fontSize: 11, fontWeight: 600 } as const,
}

// One row of nine equal boxes (per Ryan, 2026-08-20). Titles are compressed
// to survive nine-across at 1480px; the fuller explanation lives in each
// card's hover tooltip and in the table header once a queue is selected.
const QUEUES: FilterKey[] = [
  'ready', 'dependabot', 'awaiting', 'team', 'failing',
  'approved', 'drafts', 'exempt', 'all',
]

const QUEUE_COPY: Record<string, { title: string; hint: string }> = {
  ready: { title: 'Ready', hint: 'awaiting backend approval' },
  team: { title: 'Awaiting team review', hint: 'awaiting first team review' },
  awaiting: { title: 'Changes requested', hint: 'reviewer requested changes — waiting on the author' },
  failing: { title: 'Failing CI', hint: 'real check failures' },
  approved: { title: 'Approved but unmerged', hint: 'cleared, not yet merged' },
  all: { title: 'All open', hint: 'every open PR' },
  drafts: { title: 'Drafts', hint: 'work in progress' },
  dependabot: { title: 'Dependabot', hint: 'automated updates' },
  exempt: { title: 'Exempt', hint: 'backend review not required' },
}

function statusTone(key: Status): string {
  if (key === 'failing' || key === 'failing_be_approval') return T.red
  if (key === 'approved') return T.green
  if (key === 'changes_requested' || key === 'needs_reapproval') return T.amber
  return T.text
}

type SortCol = 'number' | 'title' | 'author' | 'created' | 'updated'

export default function TriageBoard({ pullRequests }: Props) {
  const [active, setActive] = useState<FilterKey>('ready')
  const [query, setQuery] = useState('')
  // Oldest-updated first by default, matching /dashboard: the forgotten PR is
  // the one triage exists to surface.
  const [sortCol, setSortCol] = useState<SortCol>('updated')
  const [sortAsc, setSortAsc] = useState(true)

  const counts = useMemo(() => countByFilter(pullRequests), [pullRequests])
  const rows = useMemo(() => {
    const filtered = applyFilter(pullRequests, active, query)
    const dir = sortAsc ? 1 : -1
    return [...filtered].sort((a, b) => {
      switch (sortCol) {
        case 'number':
          return (a.number - b.number) * dir
        case 'title':
          return a.title.localeCompare(b.title) * dir
        case 'author':
          return a.author.localeCompare(b.author) * dir
        case 'created':
          return (new Date(a.created_at).getTime() - new Date(b.created_at).getTime()) * dir
        case 'updated':
          return (new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime()) * dir
      }
    })
  }, [pullRequests, active, query, sortCol, sortAsc])

  const activeDef = FILTERS.find(f => f.key === active)

  const toggleSort = (col: SortCol) => {
    if (sortCol === col) setSortAsc(v => !v)
    else {
      setSortCol(col)
      setSortAsc(col === 'updated' || col === 'created')
    }
  }

  const openAll = () => {
    rows.forEach(pr => window.open(pr.url, '_blank', 'noopener'))
  }

  const HEADERS: Array<{ label: string; col?: SortCol; width?: string }> = [
    { label: 'PR', col: 'number', width: '80px' },
    { label: 'Diff', width: '70px' },
    { label: 'Title', col: 'title' },
    { label: 'Author', col: 'author', width: '120px' },
    { label: 'CI', width: '130px' },
    { label: 'Status', width: '130px' },
    { label: 'Created', col: 'created', width: '72px' },
    { label: 'Updated', col: 'updated', width: '80px' },
  ]

  return (
    <div style={{ background: T.bg, color: T.text, minHeight: '100vh' }}>
      <style>{`
        .queue-box {
          transition: transform 0.15s ease, box-shadow 0.15s ease,
            border-color 0.15s ease, background-color 0.15s ease;
        }
        .queue-box:hover {
          transform: translateY(-2px);
          box-shadow: 0 6px 18px rgba(0, 0, 0, 0.4),
            0 0 0 1px rgba(139, 124, 246, 0.35);
        }
        .queue-box--sel {
          box-shadow: inset 0 2px 0 ${T.accent};
        }
        .queue-box--sel:hover {
          transform: translateY(-2px);
          box-shadow: inset 0 2px 0 ${T.accent},
            0 6px 18px rgba(0, 0, 0, 0.4);
        }
        @media (prefers-reduced-motion: reduce) {
          .queue-box, .queue-box:hover, .queue-box--sel:hover {
            transition: none;
            transform: none;
          }
        }
      `}</style>
      <div className="mx-auto max-w-[1480px] px-5 sm:px-7 py-6 space-y-5">
        {/* ── One row: all nine queues as equal boxes ── */}
        <div className="grid grid-cols-3 md:grid-cols-5 lg:grid-cols-9 gap-2">
          {QUEUES.map(key => {
            const sel = key === active
            const copy = QUEUE_COPY[key]
            const isWarn = key === 'failing'
            return (
              <button
                key={key}
                onClick={() => setActive(key)}
                title={copy.hint}
                className={`queue-box ${sel ? 'queue-box--sel' : ''} text-left rounded-lg px-3 py-2.5 focus-visible:outline focus-visible:outline-2`}
                style={{
                  background: sel ? T.accentDim : T.surface,
                  border: `1px solid ${sel ? T.accent : T.line}`,
                  outlineColor: T.accent,
                }}
              >
                <div
                  className="uppercase tracking-[0.08em] leading-[1.3] min-h-[26px]"
                  style={{ ...type.label, fontSize: 10, color: sel ? T.accent : T.text }}
                >
                  {copy.title}
                </div>
                <div
                  className="mt-0.5 tabular-nums"
                  style={{
                    fontSize: 24,
                    fontWeight: 600,
                    color: isWarn && counts[key] > 0 ? T.red : T.text,
                  }}
                >
                  {counts[key]}
                </div>
              </button>
            )
          })}
        </div>

        {/* ── Search ── */}
        <div className="flex justify-start">
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Filter by title, author, #"
            className="rounded-md px-3 py-1.5 w-56 focus:outline-none placeholder-white/60"
            style={{
              ...type.secondary,
              background: T.surface,
              border: `1px solid ${T.line}`,
            }}
          />
        </div>

        {/* ── The table ── */}
        <div
          className="rounded-lg overflow-hidden"
          style={{
            background: T.surface,
            border: `1px solid ${T.line}`,
            borderTop: `2px solid ${T.accent}`,
          }}
        >
          <div
            className="flex items-center justify-between gap-3 px-4 pt-3 pb-2"
            style={{ borderBottom: `1px solid ${T.line}` }}
          >
            <div className="flex items-baseline gap-2">
              <span style={{ ...type.primary, fontWeight: 600 }}>{activeDef?.label}</span>
              <span className="tabular-nums" style={type.secondary}>
                {rows.length} {rows.length === 1 ? 'PR' : 'PRs'}
              </span>
              {QUEUE_COPY[active]?.hint && (
                <span style={type.secondary}>— {QUEUE_COPY[active].hint}</span>
              )}
            </div>
            <button
              onClick={openAll}
              className="rounded-md px-3 py-1.5 transition-colors hover:bg-white/[0.06]"
              style={{ ...type.secondary, fontWeight: 500, border: `1px solid ${T.line}` }}
              title="Open every PR in this queue in a new tab"
            >
              Open all ({rows.length})
            </button>
          </div>

          <table className="w-full table-fixed" style={{ fontSize: 14 }}>
            <colgroup>
              {HEADERS.map(h => (
                <col key={h.label} style={h.width ? { width: h.width } : undefined} />
              ))}
            </colgroup>
            <thead>
              <tr className="uppercase tracking-[0.11em]">
                {HEADERS.map(h => (
                  <th key={h.label} className="text-left px-4 py-2" style={type.label}>
                    {h.col ? (
                      <button onClick={() => toggleSort(h.col!)} className="uppercase hover:underline underline-offset-4" style={type.label}>
                        {h.label}
                      </button>
                    ) : (
                      h.label
                    )}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 && (
                <tr>
                  <td colSpan={HEADERS.length} className="px-4 py-10 text-center" style={type.secondary}>
                    Nothing in this queue. Adjust the filter above, or enjoy the moment.
                  </td>
                </tr>
              )}
              {rows.map(pr => {
                const rawStatus = classifyStatus(pr)
                const realFailuresStr = summarizeFailingChecksCompact(pr)
                // "Open" says nothing. When the generic fallback fires and CI
                // is in fact green, say the useful thing instead. And when the
                // only failing check is GitHub's required "Backend Approval
                // Check", that IS the status — red, like GitHub shows it.
                const status =
                  pr.ci_status === 'failure' && !realFailuresStr
                    ? { key: 'failing_be_approval' as const, label: 'BE Approval' }
                    : rawStatus.key === 'open' && pr.ci_status === 'success'
                      ? { ...rawStatus, label: 'Passing all CI' }
                      : rawStatus
                return (
                  <tr
                    key={`${pr.repository_name}-${pr.number}`}
                    className="cursor-pointer transition-colors hover:bg-white/[0.04]"
                    style={{ borderTop: `1px solid ${T.line}` }}
                    onClick={() => window.open(pr.url, '_blank', 'noopener')}
                  >
                    <td className="px-4 py-3 align-top">
                      <span className="tabular-nums" style={type.primary}>
                        #{pr.number}
                      </span>
                      {pr.repository_name && pr.repository_name !== 'vets-api' && (
                        <span className="block mt-0.5 truncate" style={{ ...type.secondary, fontSize: 11 }} title={pr.repository_name}>
                          {pr.repository_name.replace('vets-api-', '')}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums">
                      {typeof pr.additions === 'number' && typeof pr.deletions === 'number' ? (
                        <span
                          className="whitespace-nowrap"
                          style={type.secondary}
                          title={`${pr.additions} added, ${pr.deletions} removed${typeof pr.changed_files === 'number' ? ` across ${pr.changed_files} file${pr.changed_files === 1 ? '' : 's'}` : ''}`}
                        >
                          <span style={{ color: T.green }}>+{pr.additions}</span>{' '}
                          <span style={{ color: T.red }}>-{pr.deletions}</span>
                        </span>
                      ) : (
                        <span style={type.secondary}>—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block truncate" style={type.primary} title={pr.title}>
                        {pr.title}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="block truncate" style={type.secondary} title={pr.author}>
                        {displayUser(pr.author)}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {realFailuresStr ? (
                        <span className="block truncate" style={{ ...type.secondary, color: T.red }} title={realFailuresStr}>
                          {sentenceCase(realFailuresStr)}
                        </span>
                      ) : pr.ci_status === 'success' ? (
                        <span style={{ ...type.secondary, color: T.green }}>Passing</span>
                      ) : pr.ci_status === 'failure' ? (
                        // Only the backend-approval gate is failing — that is
                        // review state, not broken CI. Say what it means.
                        <span className="block truncate" style={{ ...type.secondary, color: T.amber }} title="Requires backend approval">
                          Needs BE approval
                        </span>
                      ) : (
                        <span style={type.secondary}>Pending</span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <span className="inline-flex items-center gap-1.5 max-w-full">
                        <span className="h-1.5 w-1.5 rounded-full shrink-0" style={{ background: statusTone(status.key) }} />
                        <span className="truncate" style={type.secondary} title={status.label}>
                          {status.label}
                        </span>
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums" style={type.secondary} title={`opened ${absoluteTime(pr.created_at)}`}>
                      {timeAgoShort(pr.created_at)}
                    </td>
                    <td className="px-4 py-3 align-top tabular-nums" style={type.secondary} title={absoluteTime(pr.updated_at)}>
                      {timeAgoShort(pr.updated_at)}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  )
}

// CI-cell strings render sentence-cased here; the shared summaries stay
// lowercase for designs that use them as terminal-style tags.
function sentenceCase(s: string): string {
  return s.length > 0 ? s[0].toUpperCase() + s.slice(1) : s
}

