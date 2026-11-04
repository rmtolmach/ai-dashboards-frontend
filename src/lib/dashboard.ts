import {
  type PullRequest,
  isReadyForReview,
  isAwaitingAuthorChanges,
  isFinishedUnmerged,
  hasFailingCi,
  hasNonReviewFailingChecks,
  hasCommitsAfterApproval,
  hasDismissedBackendApproval,
  isDependabot,
  isTrulyExemptFromBackendReview,
  needsFirstTeamReview,
  needsDevOpsReview,
} from '../types/pull-request'
import { displayUser, isGhostUser } from './utils'

export type FilterKey =
  | 'ready'
  | 'team'
  | 'awaiting'
  | 'failing'
  | 'drafts'
  | 'dependabot'
  | 'approved'
  | 'exempt'
  | 'all'
  | 'devops'

export interface FilterDef {
  key: FilterKey
  label: string
  predicate: (pr: PullRequest) => boolean
}

// Failing CI bucket should only include PRs whose CI is failing on a
// "real" check — i.e., not just "Backend review required" or other
// review-related chicken-and-egg checks.
export function isInFailingCiBucket(pr: PullRequest): boolean {
  if (pr.draft) return false
  if (isDependabot(pr)) return false
  if (isTrulyExemptFromBackendReview(pr)) return false
  return hasFailingCi(pr) && hasNonReviewFailingChecks(pr)
}

// PRs awaiting vsp-operations review belong to DevOps Open alone; every
// other queue is backend-only and never shows them.
const backendOnly = (predicate: (pr: PullRequest) => boolean) =>
  (pr: PullRequest) => !needsDevOpsReview(pr) && predicate(pr)

const BACKEND_FILTERS: FilterDef[] = [
  { key: 'ready', label: 'Backend Ready', predicate: isReadyForReview },
  { key: 'team', label: 'Needing team review', predicate: needsFirstTeamReview },
  { key: 'awaiting', label: 'Awaiting author', predicate: isAwaitingAuthorChanges },
  { key: 'failing', label: 'Failing CI', predicate: isInFailingCiBucket },
  { key: 'approved', label: 'Approved · unmerged', predicate: isFinishedUnmerged },
  { key: 'drafts', label: 'Drafts', predicate: pr => pr.draft },
  { key: 'dependabot', label: 'BE Dependabot, etc.', predicate: isDependabot },
  { key: 'exempt', label: 'Exempt BE review', predicate: pr => !pr.draft && isTrulyExemptFromBackendReview(pr) },
  { key: 'all', label: 'All open', predicate: pr => pr.state === 'open' },
]

export const FILTERS: FilterDef[] = [
  ...BACKEND_FILTERS.map(f => ({ ...f, predicate: backendOnly(f.predicate) })),
  { key: 'devops', label: 'DevOps Open', predicate: needsDevOpsReview },
]

export type Status =
  | 'failing'
  | 'failing_be_approval'
  | 'pending_be_review'
  | 'changes_requested'
  | 'needs_reapproval'
  | 'ci_pending'
  | 'approved'
  | 'ready'
  | 'draft'
  | 'open'
  | 'devops'

export function classifyStatus(pr: PullRequest): { key: Status; label: string } {
  const changesRequested = pr.approval_summary?.changes_requested_count || 0
  const blockingChanges =
    changesRequested > 0 &&
    pr.changes_requested_info?.status !== 'new_commit_from_author' &&
    pr.changes_requested_info?.status !== 'new_comment_from_author'

  if (pr.draft) return { key: 'draft', label: 'Draft' }

  // hasNonReviewFailingChecks already excludes the backend-review gate. If
  // there are real failures, label by count of REAL failing checks (i.e.
  // exclude the BE gate from the displayed number too).
  const realFailingCount = (pr.failing_checks || []).filter(
    c => !isReviewGate((c.name || '').toLowerCase())
  ).length
  if (pr.ci_status === 'failure' && realFailingCount > 0) {
    return { key: 'failing', label: `${realFailingCount} failing` }
  }

  // Backend-review states below don't apply to DevOps PRs.
  if (needsDevOpsReview(pr)) {
    if (pr.ci_status === 'pending' || (pr.pending_checks ?? 0) > 0) {
      return { key: 'ci_pending', label: 'CI running' }
    }
    return { key: 'devops', label: 'Awaiting DevOps' }
  }

  // The PR needs a re-review and the stale approval shouldn't read as "Ready":
  // either the author pushed commits after a backend approval, or a backend
  // approval was dismissed (e.g. master merged in). CI isn't really broken here
  // (checked above), so surface it distinctly.
  if (hasCommitsAfterApproval(pr)) {
    return { key: 'needs_reapproval', label: 'Needs re-approval' }
  }
  if (hasDismissedBackendApproval(pr)) {
    return { key: 'needs_reapproval', label: 'BE approval dismissed' }
  }

  if (blockingChanges) return { key: 'changes_requested', label: 'Changes requested' }
  if (pr.ci_status === 'pending' || (pr.pending_checks ?? 0) > 0) {
    // Distinguish "CI is genuinely running" from "the only thing pending is
    // the backend-approval gate". A PR with `require-backend-approval` label,
    // no BE approval yet, no blocking changes-requested, and only pending
    // checks (no real failures) is waiting on BE review group.
    const requiresBE =
      !!pr.labels?.includes('require-backend-approval') ||
      !!pr.ready_for_backend_review
    const beNotApproved = pr.backend_approval_status !== 'approved'
    if (requiresBE && beNotApproved) {
      return { key: 'pending_be_review', label: 'Pending BE review group review' }
    }
    return { key: 'ci_pending', label: 'CI running' }
  }
  if (isFinishedUnmerged(pr)) return { key: 'approved', label: 'Approved' }
  if (isReadyForReview(pr)) {
    // If CI is "failing" only because of the BE-approval gate, surface that
    // explicitly — these PRs are ready, but the GHE merge button is blocked
    // until a backend reviewer approves.
    if (pr.ci_status === 'failure' && (pr.failed_checks || 0) > 0) {
      return { key: 'failing_be_approval', label: 'Failing backend approval' }
    }
    return { key: 'ready', label: 'Ready' }
  }
  return { key: 'open', label: 'Open' }
}

export interface ReviewerBadge {
  user: string
  state: 'approved' | 'changes_requested' | 'commented'
}

export function reviewerBadgesFor(pr: PullRequest): ReviewerBadge[] {
  const summary = pr.approval_summary
  if (!summary) return []
  const badges: ReviewerBadge[] = []
  summary.approved_users?.forEach(u => badges.push({ user: u, state: 'approved' }))
  summary.changes_requested_users?.forEach(u =>
    badges.push({ user: u, state: 'changes_requested' })
  )
  summary.commented_users?.forEach(u => {
    if (!badges.find(b => b.user === u)) badges.push({ user: u, state: 'commented' })
  })
  return badges
}

export function timeAgo(iso: string): string {
  const d = new Date(iso).getTime()
  const seconds = Math.max(1, Math.floor((Date.now() - d) / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  if (days < 30) return `${days}d`
  const months = Math.floor(days / 30)
  if (months < 12) return `${months}mo`
  return `${Math.floor(months / 12)}y`
}

export function absoluteTime(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  })
}

// Shorter Eastern-time stamp (no year) for the Changes Requested cell and
// approval timestamps, where the row context already implies "recent."
export function fmtEastern(iso: string): string {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: 'America/New_York',
  })
}

export interface ChangesRequestedCell {
  label: string
  when: string | null
  // Semantic tone, not a color — callers map this to their own palette.
  tone: 'red' | 'amber' | 'neutral'
}

// Mirrors /dashboard's Changes Requested column exactly: the same per-status
// labels, the same ET timestamp, and the same fallback to the latest reviewer
// activity when no changes-requested status exists — so every design agrees
// with /dashboard about a row's changes-requested state.
export function changesRequestedCell(pr: PullRequest): ChangesRequestedCell | null {
  const info = pr.changes_requested_info
  if (info) {
    const ts =
      info.status === 'changes_requested'
        ? info.requested_at || info.backend_comment_at
        : info.status === 'new_commits_after_approval'
          ? info.approved_at
          : info.status === 'backend_approval_dismissed' || info.status === 'new_commit_from_author'
            ? info.dismissed_at
            : info.status === 'new_comment_from_author'
              ? info.author_comment_at || info.backend_comment_at
              : null
    const label =
      info.status === 'new_commit_from_author'
        ? 'New commits by author'
        : info.status === 'new_comment_from_author'
          ? 'New comment from author'
          : info.status === 'new_commits_after_approval'
            ? 'New commits after approval'
            : info.status === 'backend_approval_dismissed'
              ? 'BE approval dismissed'
              : info.message
    const tone: ChangesRequestedCell['tone'] =
      info.status === 'backend_approval_dismissed'
        ? 'red'
        : info.status === 'new_commits_after_approval' || info.status === 'changes_requested'
          ? 'amber'
          : 'neutral'
    return { label, when: ts ? fmtEastern(ts) : null, tone }
  }
  const act = pr.latest_reviewer_activity
  if (act) {
    return {
      label: `${displayUser(act.user)} ${act.type === 'comment' ? 'commented' : act.type}`,
      when: fmtEastern(act.timestamp),
      tone: 'neutral',
    }
  }
  return null
}

// Filters out "Backend Approval / Succeed if backend approval is confirmed"
// and similar review-required checks that are chicken-and-egg failures
// (they're only failing because the review hasn't happened).
function isReviewGate(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('backend approval') ||
    n.includes('succeed if backend') ||
    n.includes('backend review') ||
    // Hyphenated team name ("Check for backend-review-group approval").
    n.includes('backend-review-group') ||
    n.includes('require backend') ||
    // The "Status Checks" rollup IS the backend-approval gate on vets-api:
    // 37 of 41 audited "failures" were only this check, with real CI green.
    n === 'status checks'
  )
}

// Tidy up GitHub-style check names so the table can render them readably.
//
// GHE check names come in formats like:
//   "Code Checks / Test (Group 15) (pull_request)"
//     → "Test (Group 15)"
//   "Build And Publish Preview Environment / Test Results (push)"
//     → "Test Results"
//   ".github/workflows/build-and-publish.yaml / Test Results (push)"
//     → "Test Results"
//   "rspec / unit (4/8)"
//     → "rspec / unit"   (no trailing trigger suffix, single segment)
//
// Strategy: drop the workflow trigger suffix, drop the workflow prefix
// (everything before the first " / "), then drop matrix counters.
function tidyCheckName(name: string): string {
  let n = name.trim()
  // Drop the workflow trigger suffix: "(push)", "(pull_request)", "(pull_request_review)"
  n = n.replace(/\s*\((?:push|pull_request|pull_request_review|workflow_dispatch|schedule|workflow_run|merge_group)\)\s*$/i, '')
  // Drop the workflow prefix — anything before the first " / ", as long as
  // the remaining segment is still descriptive (more than 3 chars).
  // This converts "Code Checks / Test (Group 15)" → "Test (Group 15)".
  const slashSplit = n.split(/\s+\/\s+/)
  if (slashSplit.length > 1) {
    const tail = slashSplit.slice(1).join(' / ').trim()
    if (tail.length >= 4) n = tail
  }
  // Drop parametric suffix counters: " (4/8)", " [node 18]"
  n = n.replace(/\s*\(\d+\/\d+\)\s*$/, '')
  n = n.replace(/\s*\[[^\]]+\]\s*$/, '')
  return n.trim() || name
}

// Group failing CI checks into a compact summary.
//
//   "rspec / unit (4/8)", "rspec / unit (5/8)", "brakeman"
//     → "rspec / unit ×2 · brakeman"
//
// Skips review-gate checks ("Backend Approval / …") since the user already
// knows the PR needs a review.
export function summarizeFailingChecks(pr: PullRequest): string {
  if (!pr.failing_checks || pr.failing_checks.length === 0) return ''
  const groups: Record<string, number> = {}
  for (const check of pr.failing_checks) {
    const raw = (check.name || '').trim()
    if (!raw) continue
    if (isReviewGate(raw)) continue
    const root = tidyCheckName(raw)
    groups[root] = (groups[root] || 0) + 1
  }
  return Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(' · ')
}

// Compact failure summary for tight layouts (Brutalist's 2-line clamp).
// Maps verbose workflow names to short tags and groups by family — so a
// PR failing 3 different "Build And Publish Preview Environment" steps
// shows as "preview build ×3" instead of one truncated line.
const SHORT_NAME_PATTERNS: Array<[RegExp, string]> = [
  [/build\s*and\s*publish\s*preview/i, 'preview build'],
  [/build\s*and\s*cache\s*docker/i, 'docker build'],
  [/^code\s*checks$/i, 'code checks'],
  [/^test\b.*\bgroup/i, 'test groups'],
  [/^test\s*results/i, 'test results'],
  [/^lint/i, 'lint'],
  [/codeql/i, 'codeql'],
  [/danger/i, 'danger'],
  [/^pr\s*labeler/i, 'pr labeler'],
  [/codeowners/i, 'codeowners'],
  [/service[_\s]*tag/i, 'service tags'],
  [/datadog/i, 'datadog'],
  [/settings/i, 'settings'],
]

function shortFailureTag(name: string): string {
  const tidied = tidyCheckName(name)
  for (const [re, tag] of SHORT_NAME_PATTERNS) {
    if (re.test(tidied)) return tag
  }
  // Fallback: lowercase + drop bracket noise, cap at 22 chars
  const cleaned = tidied.toLowerCase().replace(/\s*\(.*?\)\s*$/, '').trim()
  return cleaned.length > 22 ? cleaned.slice(0, 22) + '…' : cleaned
}

export function summarizeFailingChecksCompact(pr: PullRequest): string {
  if (!pr.failing_checks || pr.failing_checks.length === 0) return ''
  const groups: Record<string, number> = {}
  for (const check of pr.failing_checks) {
    const raw = (check.name || '').trim()
    if (!raw) continue
    if (isReviewGate(raw)) continue
    const tag = shortFailureTag(raw)
    groups[tag] = (groups[tag] || 0) + 1
  }
  return Object.entries(groups)
    .sort((a, b) => b[1] - a[1])
    .map(([name, n]) => (n > 1 ? `${name} ×${n}` : name))
    .join(' · ')
}

export interface ActivitySummary {
  // Most recent event for the headline
  latestLabel: string // "Author responded" | "Backend reviewer commented" | "Approved"
  latestTimeAgo: string // "5h ago"
  // Optional rollup line
  rollup: string // "3 author · 1 BR cmt · 2 team"
}

export function summarizeActivity(
  pr: PullRequest,
  backendReviewers: string[]
): ActivitySummary {
  const latestTimeAgo = `${timeAgo(pr.updated_at)} ago`
  let latestLabel = 'updated'

  // Determine the most recent meaningful action.
  if (pr.changes_requested_info?.status === 'new_commit_from_author') {
    latestLabel = 'Author pushed commit'
  } else if (pr.changes_requested_info?.status === 'new_comment_from_author') {
    latestLabel = 'Author responded'
  } else if (pr.backend_approval_status === 'approved') {
    latestLabel = 'Backend approved'
  } else if (pr.approval_summary && pr.approval_summary.approved_count > 0) {
    const beApprover = pr.approval_summary.approved_users?.find(u =>
      backendReviewers.includes(u)
    )
    latestLabel = beApprover ? 'Backend approved' : 'Team approved'
  } else if (
    pr.approval_summary?.changes_requested_users?.some(u => backendReviewers.includes(u))
  ) {
    latestLabel = 'BR requested changes'
  } else if (pr.approval_summary?.changes_requested_count) {
    latestLabel = 'Changes requested'
  } else if (pr.latest_reviewer_activity?.type === 'comment') {
    const isBE = backendReviewers.includes(pr.latest_reviewer_activity.user)
    latestLabel = isBE ? 'BR commented' : 'Reviewer commented'
  } else if (pr.draft) {
    latestLabel = 'Draft updated'
  }

  // Build the rollup. We need counts split by author/BR/team.
  // We can only infer from approval_summary, since we don't have a full
  // per-comment timeline. Use commented_users + author = assumption.
  const commenters = pr.approval_summary?.commented_users || []
  const authorComments = commenters.filter(u => u === pr.author).length
  const beComments = commenters.filter(u => backendReviewers.includes(u) && u !== pr.author).length
  const teamComments = commenters.length - authorComments - beComments

  const parts: string[] = []
  if (authorComments) parts.push(`${authorComments} author`)
  if (beComments) parts.push(`${beComments} BR`)
  if (teamComments) parts.push(`${teamComments} team`)

  return {
    latestLabel,
    latestTimeAgo,
    rollup: parts.join(' · '),
  }
}

export function nameFromHandle(handle: string): string {
  if (!handle) return ''
  if (isGhostUser(handle)) return '?'
  const parts = handle.split(/[-_]+/).filter(Boolean)
  if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
  return handle.slice(0, 2).toUpperCase()
}

export function countByFilter(prs: PullRequest[]): Record<FilterKey, number> {
  const base: Record<FilterKey, number> = {
    ready: 0,
    team: 0,
    awaiting: 0,
    failing: 0,
    drafts: 0,
    dependabot: 0,
    approved: 0,
    exempt: 0,
    all: 0,
    devops: 0,
  }
  for (const pr of prs) for (const f of FILTERS) if (f.predicate(pr)) base[f.key]++
  return base
}

export function applyFilter(
  prs: PullRequest[],
  filterKey: FilterKey,
  searchTerm: string
): PullRequest[] {
  const filterDef = FILTERS.find(f => f.key === filterKey)!
  let list = prs.filter(filterDef.predicate)
  if (searchTerm) {
    const q = searchTerm.toLowerCase()
    list = list.filter(pr => {
      // Reviewer names too, so "rebecca" surfaces every PR Rebecca-Tolmach
      // approved (or requested changes on / commented on) — the same names
      // the Approvals column renders.
      const reviewers = [
        ...(pr.approval_summary?.approved_users || []),
        ...(pr.approval_summary?.changes_requested_users || []),
        ...(pr.approval_summary?.commented_users || []),
      ]
      return (
        pr.title.toLowerCase().includes(q) ||
        pr.author.toLowerCase().includes(q) ||
        String(pr.number).includes(q) ||
        (pr.repository_name || '').toLowerCase().includes(q) ||
        reviewers.some(u => (u || '').toLowerCase().includes(q))
      )
    })
  }
  list.sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
  return list
}

// Compact age for tight table cells: "5m", "3h", "12d". Pass a suffix when a
// design wants the wordier form ("3h ago").
export function timeAgoShort(iso: string, suffix = ''): string {
  const secs = Math.max(0, Math.floor((Date.now() - new Date(iso).getTime()) / 1000))
  if (secs < 3600) return `${Math.max(1, Math.floor(secs / 60))}m${suffix}`
  if (secs < 86400) return `${Math.floor(secs / 3600)}h${suffix}`
  return `${Math.floor(secs / 86400)}d${suffix}`
}
