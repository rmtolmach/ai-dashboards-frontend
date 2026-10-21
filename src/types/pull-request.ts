export interface CheckRun {
  name: string
  status: string
  url: string
  description?: string
  required?: boolean
}

export interface PullRequest {
  id: number
  number: number
  title: string
  author: string
  created_at: string
  updated_at: string
  url: string
  state: string
  draft: boolean
  mergeable?: boolean
  additions?: number
  deletions?: number
  changed_files?: number
  ci_status: string
  failing_checks: CheckRun[]
  total_checks: number
  successful_checks: number
  failed_checks: number
  pending_checks?: number
  backend_approval_status: string
  ready_for_backend_review: boolean
  pending_reviewers?: string[]
  pending_teams?: string[]
  approval_summary?: {
    status: string
    approved_count: number
    changes_requested_count: number
    pending_count: number
    approved_users: string[]
    approved_user_details?: { user: string; submitted_at: string }[]
    changes_requested_users: string[]
    commented_users: string[]
    pending_users: string[]
    pending_teams: string[]
  }
  labels?: string[]
  repository_name?: string
  repository_owner?: string
  awaiting_author_changes?: boolean
  changes_requested_info?: {
    status: string
    message: string
    backend_commenter?: string
    backend_comment_at?: string
    author_comment_at?: string
    backend_reviewer?: string
    dismissed_at?: string
    requested_at?: string
    approved_at?: string
  } | null
  latest_reviewer_activity?: {
    message: string
    user: string
    type: string
    reviewer_type: string
    timestamp: string
    preview?: string
    url?: string
  } | null
}

export interface ApiResponse {
  pull_requests: PullRequest[]
  approved_pull_requests: PullRequest[]
  count: number
  approved_count: number
  repository: string
  last_updated: string
  updating: boolean
  rate_limit?: {
    remaining: number
    limit: number
    resets_at: string
  }
}

// GHE handles for the backend-review-group team. Synced manually with
// https://va.ghe.com/orgs/software/teams/backend-review-group/members
export const BACKEND_REVIEWERS = [
  'Lindsey-Hattamer',
  'Rebecca-Tolmach',
  'STEVEN-CUMMING',
  'Joseph-Weissman',
  'Jennica-Stiehl',
  'CURT-BONADE',
  'Craig-Donavin',
  'RYAN-JOHNSON26',
  'Rachal-Cassity',
]

// PRs with this label are correctly labeled as exempt UNLESS they have a
// Lighthouse team indicator (claimsApi). Lighthouse teams were removed from
// the exemption list on Dec 1, 2025 per PR #25353.
const LIGHTHOUSE_LABELS = ['claimsApi']

export function isTrulyExemptFromBackendReview(pr: PullRequest): boolean {
  if (!pr.labels || !pr.labels.includes('exempt-be-review')) return false
  if (pr.labels.some(label => LIGHTHOUSE_LABELS.includes(label))) return false
  return true
}

// Some failing checks are review-related chicken-and-egg signals — they fail
// because there's no review yet. They shouldn't block "Ready for Review".
const REVIEW_RELATED_CHECKS = new Set([
  'Pull Request Ready for Review',
  'Danger',
  'Status Checks',
  'Get PR data',
  'Get PR Data',
  'Check Workflow Statuses',
])

// Matches "Backend Approval / Succeed if backend approval is confirmed",
// "Require backend-r…", and similar review-gate checks.
function isBackendReviewGate(name: string): boolean {
  const n = name.toLowerCase()
  return (
    n.includes('backend approval') ||
    n.includes('succeed if backend') ||
    n.includes('backend review') ||
    // Hyphenated team name: "Check for backend-review-group approval" is a
    // review gate, but "backend review" above doesn't match it.
    n.includes('backend-review-group') ||
    n.includes('require backend')
  )
}

export function hasNonReviewFailingChecks(pr: PullRequest): boolean {
  if (!pr.failing_checks || pr.failing_checks.length === 0) return false
  return pr.failing_checks.some(check => {
    const name = check.name || ''
    if (isBackendReviewGate(name)) return false
    if (REVIEW_RELATED_CHECKS.has(name)) return false
    if (name.includes('Get PR Data')) return false
    return true
  })
}

// Filtering helpers shared across dashboard variants.

function authorHasRespondedToChanges(pr: PullRequest): boolean {
  return (
    pr.changes_requested_info?.status === 'new_commit_from_author' ||
    pr.changes_requested_info?.status === 'new_comment_from_author'
  )
}

function hasUnresolvedChangesRequested(pr: PullRequest): boolean {
  return !!(
    pr.approval_summary?.changes_requested_count &&
    pr.approval_summary.changes_requested_count > 0 &&
    !authorHasRespondedToChanges(pr)
  )
}

export function needsTeamApproval(pr: PullRequest): boolean {
  if (!pr.labels?.includes('waiting-for-team-approval')) return false
  const hasNonBackendApproval =
    !!pr.approval_summary &&
    pr.approval_summary.approved_count > 0 &&
    !!pr.approval_summary.approved_users?.some(u => !BACKEND_REVIEWERS.includes(u))
  return !hasNonBackendApproval
}

export function isReadyForReview(pr: PullRequest): boolean {
  // Hard exclusions
  if (pr.draft) return false
  if (isDependabot(pr)) return false
  if (isTrulyExemptFromBackendReview(pr)) return false
  // Re-review needed: either the author pushed new commits AFTER a backend
  // approval (stale approval still on record), or a backend approval was
  // DISMISSED (e.g. the author merged master in). Both can carry a stale
  // backend_approval_status / approved_users that the exclusions below would
  // otherwise drop — surface them as Ready (for re-approval) instead, as long
  // as CI isn't really broken.
  if (needsReReview(pr)) {
    if (pr.ci_status === 'failure' && hasNonReviewFailingChecks(pr)) return false
    return true
  }

  if (pr.backend_approval_status === 'approved') return false
  if (pr.approval_summary?.approved_users?.some(u => BACKEND_REVIEWERS.includes(u))) return false
  if (needsTeamApproval(pr)) return false

  // Real CI failures (not the "backend review required" chicken-and-egg)
  // belong in Failing CI.
  if (pr.ci_status === 'failure' && hasNonReviewFailingChecks(pr)) return false

  // Unresolved changes-requested → Awaiting Changes, not Ready.
  // (Once the author commits or comments after, the PR comes back here.)
  if (hasUnresolvedChangesRequested(pr)) return false

  // Unresolved BACKEND-comment feedback (not a formal CR, but a BE reviewer
  // commented and no later approval/author-response supersedes it) → Awaiting
  // Changes, not Ready — even if a teammate has approved. The backend computes
  // this with full timestamps and signals it via changes_requested_info. Once
  // the author responds, the status flips to new_comment/commit_from_author and
  // the PR returns to Ready.
  if (pr.changes_requested_info?.status === 'changes_requested') return false

  // Inclusion criteria — any of:
  // 1. Non-backend team has approved
  const hasNonBackendApproval = !!(
    pr.approval_summary &&
    pr.approval_summary.approved_count > 0 &&
    pr.approval_summary.approved_users?.some(u => !BACKEND_REVIEWERS.includes(u))
  )
  if (hasNonBackendApproval) return true

  // 2. Author is themselves a backend reviewer — Ready only after a teammate
  //    has weighed in (an approval). A BE author's PR still needs review.
  if (
    BACKEND_REVIEWERS.includes(pr.author) &&
    pr.approval_summary &&
    pr.approval_summary.approved_count > 0
  ) {
    return true
  }

  // 3. Backend flagged as ready for review (with approvals)
  if (pr.ready_for_backend_review && pr.approval_summary && pr.approval_summary.approved_count > 0) {
    return true
  }

  // 4. Author responded to a previous changes-request — Ready only if there
  //    is an actual standing approval. Without one, the author's response
  //    means "re-review pending," not ready.
  if (
    authorHasRespondedToChanges(pr) &&
    pr.approval_summary &&
    pr.approval_summary.approved_count > 0
  ) {
    return true
  }

  // 5. Non-vets-api repos (platform-atlas, vets-api-mockdata) only land in
  //    Ready once CI is green AND someone has at least commented or
  //    requested changes — i.e., there's evidence a reviewer engaged.
  //    A bare PR with no signal isn't "ready", it's just open.
  const isNonVetsApi =
    pr.repository_name === 'platform-atlas' || pr.repository_name === 'vets-api-mockdata'
  if (isNonVetsApi && pr.ci_status === 'success') {
    const hasReviewerSignal = !!(
      pr.approval_summary &&
      (pr.approval_summary.approved_count > 0 ||
        pr.approval_summary.changes_requested_count > 0 ||
        (pr.approval_summary.commented_users?.length ?? 0) > 0)
    )
    if (hasReviewerSignal) return true
  }

  return false
}

export function isAwaitingAuthorChanges(pr: PullRequest): boolean {
  if (pr.draft) return false
  if (isTrulyExemptFromBackendReview(pr)) return false

  // (a) A backend reviewer formally requested changes, and the author has
  // not responded since.
  if (hasUnresolvedChangesRequested(pr)) {
    const blamedBackendReviewer = pr.approval_summary?.changes_requested_users?.some(u =>
      BACKEND_REVIEWERS.includes(u)
    )
    if (blamedBackendReviewer) return true
    if (pr.awaiting_author_changes) return true
  }

  // (b) A backend reviewer left feedback (a comment or COMMENTED review) that
  // the author hasn't responded to and that no approval supersedes. The backend
  // computes this with full timestamps in `changes_requested_info`: it returns
  // status 'changes_requested' only when the latest BE feedback has no later
  // approval (BE or teammate) AND no later author response. Trust that signal —
  // it correctly honors the "comment after approval" timing rule, which the
  // frontend can't compute itself (approval_summary has no timestamps).
  //
  // 'new_comment_from_author'/'new_commit_from_author' mean the author HAS
  // responded → those flip back toward Ready, so they are NOT awaiting-changes.
  if (pr.changes_requested_info?.status === 'changes_requested') return true

  return false
}

export function hasCommitsAfterApproval(pr: PullRequest): boolean {
  return pr.changes_requested_info?.status === 'new_commits_after_approval'
}

// A backend reviewer's approval was DISMISSED (commonly because the author
// merged master/main into the branch) with no current backend approval.
export function hasDismissedBackendApproval(pr: PullRequest): boolean {
  return pr.changes_requested_info?.status === 'backend_approval_dismissed'
}

// Either re-review trigger: new commits after approval, or a dismissed backend
// approval. In both cases the PR needs a fresh backend review.
export function needsReReview(pr: PullRequest): boolean {
  return hasCommitsAfterApproval(pr) || hasDismissedBackendApproval(pr)
}

// A PR can carry approvals and green CI and still be unmergeable because a
// codeowner team (or individual) has an outstanding review request. GitHub
// surfaces this as "Waiting on code owner review"; we read it from the
// requested_reviewers/requested_teams fields on the PR list payload.
export function hasPendingTeamReview(pr: PullRequest): boolean {
  return (pr.pending_reviewers?.length ?? 0) > 0 || (pr.pending_teams?.length ?? 0) > 0
}

export function isFinishedUnmerged(pr: PullRequest): boolean {
  // Still awaiting a requested reviewer/codeowner -> not finished; it belongs
  // in "PRs Needing Team Review" until that review lands. This holds even when
  // backend has already approved: backend often reviews before the owning team,
  // and GitHub still blocks the merge on the outstanding codeowner review.
  if (hasPendingTeamReview(pr)) return false
  // Backend-approved + open + green CI + not dependabot. A BE-approved PR
  // with broken CI belongs in Failing CI (since it can't be merged), and
  // dependabot PRs have their own bucket.
  //
  // A PR that needs re-review (new commits after approval, or a dismissed
  // backend approval) is no longer "finished" — send it back to Ready for
  // Review.
  if (needsReReview(pr)) return false
  return (
    pr.backend_approval_status === 'approved' &&
    pr.state === 'open' &&
    pr.ci_status !== 'failure' &&
    !isDependabot(pr)
  )
}

// "Needing team review" — vets-api PR that hasn't been picked up yet.
// Either explicitly tagged waiting-for-team-approval, OR has no approvals
// AND no unresolved changes-requested. Used by the old dashboard's
// "PRs Needing Team Review" card.
export function needsFirstTeamReview(pr: PullRequest): boolean {
  if (pr.draft) return false
  if (isDependabot(pr)) return false
  if (isTrulyExemptFromBackendReview(pr)) return false
  // Only applies to vets-api (other repos don't require team review)
  if (pr.repository_name === 'platform-atlas') return false
  if (pr.repository_name === 'vets-api-mockdata') return false

  // An outstanding codeowner/team review request keeps the PR here. Backend
  // approval does NOT clear it: backend reviewers often approve before the
  // owning team does, and the codeowner review is a separate, still-required
  // gate (GitHub reports these as "Merging is blocked — waiting on code owner
  // review"). So a backend-approved PR with a pending team goes back to
  // needing team approval rather than counting as finished.
  //
  // The one exclusion is a real CI failure, which belongs in Failing CI. Note a
  // failing "Backend Approval Check" is NOT one — that check failing IS the
  // awaiting-review signal, which hasNonReviewFailingChecks filters out.
  if (hasPendingTeamReview(pr) && !hasNonReviewFailingChecks(pr)) {
    return true
  }

  // BE approval (or any approval) is decisive — those PRs aren't waiting
  // for a first team review even if they still carry the
  // waiting-for-team-approval label. Check this *before* needsTeamApproval
  // so a stale label doesn't override an existing approval.
  const hasAnyApproval = !!(
    pr.approval_summary && pr.approval_summary.approved_count > 0
  )
  const beApproved =
    pr.backend_approval_status === 'approved' ||
    !!pr.approval_summary?.approved_users?.some(u => BACKEND_REVIEWERS.includes(u))
  if (hasAnyApproval || beApproved) return false

  if (needsTeamApproval(pr)) return true

  // PRs already in "Awaiting Changes" (formal CR or BE line-comment feedback
  // without resolution) don't double-bucket as NTR.
  if (isAwaitingAuthorChanges(pr)) return false

  const blockingCR = !!(
    pr.approval_summary?.changes_requested_count &&
    pr.approval_summary.changes_requested_count > 0 &&
    pr.changes_requested_info?.status !== 'new_commit_from_author' &&
    pr.changes_requested_info?.status !== 'new_comment_from_author'
  )
  return !blockingCR
}

export function hasFailingCi(pr: PullRequest): boolean {
  return pr.ci_status === 'failure'
}

export function isDependabot(pr: PullRequest): boolean {
  if (pr.author === 'dependabot[bot]') return true
  // Bot-generated register-app PRs share the Dependabot bucket.
  if (pr.labels?.includes('register-app')) return true
  // GHE migration anonymized some author names to opaque archive identifiers
  // (long alphanumeric strings). Detect dependabot via the title signature
  // ("Bump <pkg> from <x> to <y>") and a non-human-looking author.
  const looksLikeArchiveId = /^[A-Za-z0-9]{20,}$/.test(pr.author || '')
  const titleLooksLikeDependabot = /^Bump [\w@.\-/[\]]+ from [\d.]+ to [\d.]+/.test(pr.title || '')
  return looksLikeArchiveId && titleLooksLikeDependabot
}

export function repoFullName(pr: PullRequest): string {
  return `${pr.repository_owner}/${pr.repository_name}`
}
