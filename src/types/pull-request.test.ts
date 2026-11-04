import { describe, it, expect } from 'vitest'
import {
  hasPendingTeamReview,
  isFinishedUnmerged,
  hasNonReviewFailingChecks,
  needsFirstTeamReview,
  needsDevOpsReview,
} from './pull-request'
import type { PullRequest } from './pull-request'

// Minimal PR shaped like the API payload — only the fields these predicates read.
const base = (over: Partial<PullRequest> = {}): PullRequest =>
  ({
    number: 1,
    title: 't',
    author: 'a',
    state: 'open',
    draft: false,
    ci_status: 'success',
    backend_approval_status: 'approved',
    repository_name: 'vets-api',
    labels: [],
    failing_checks: [],
    pending_reviewers: [],
    pending_teams: [],
    ...over,
  }) as unknown as PullRequest

describe('hasPendingTeamReview', () => {
  it('is true when a codeowner team is still pending (PR #29601)', () => {
    expect(hasPendingTeamReview(base({ pending_teams: ['benefits-non-disability'] }))).toBe(true)
  })

  it('is true when an individual reviewer is still pending', () => {
    expect(hasPendingTeamReview(base({ pending_reviewers: ['Jennica-Stiehl'] }))).toBe(true)
  })

  it('is false when nothing is pending', () => {
    expect(hasPendingTeamReview(base())).toBe(false)
  })

  it('is false when the fields are absent from the payload', () => {
    expect(
      hasPendingTeamReview(base({ pending_reviewers: undefined, pending_teams: undefined })),
    ).toBe(false)
  })
})

describe('isFinishedUnmerged', () => {
  it('excludes a PR still blocked on a pending codeowner (PR #29601 today)', () => {
    expect(
      isFinishedUnmerged(
        base({ pending_teams: ['benefits-non-disability'], backend_approval_status: 'not_approved' }),
      ),
    ).toBe(false)
  })

  it('includes it once the codeowner approves (PR #29601 after approval)', () => {
    expect(isFinishedUnmerged(base({ pending_teams: [] }))).toBe(true)
  })

  it('still excludes PRs with failing CI and no backend approval (#29631/#29627)', () => {
    expect(
      isFinishedUnmerged(base({ ci_status: 'failure', backend_approval_status: 'not_approved' })),
    ).toBe(false)
  })

  // #29627 / #28565 / #29650: backend-approved but GitHub still reports
  // "Merging is blocked — waiting on code owner review". Backend approval does
  // not substitute for the team's own review, so these are NOT finished.
  it('excludes a backend-approved PR still awaiting a codeowner team', () => {
    expect(
      isFinishedUnmerged(
        base({ pending_teams: ['govcio-vfep-codereviewers'], backend_approval_status: 'approved' }),
      ),
    ).toBe(false)
  })
})

describe('hasNonReviewFailingChecks', () => {
  const withChecks = (names: string[]) =>
    base({ ci_status: 'failure', failing_checks: names.map(name => ({ name })) as never })

  // 37 of 41 pending+failing PRs fail ONLY on the backend-approval gate; their
  // real CI is green. Verified against GHE.
  it('does not treat a failing "Status Checks" rollup as a real CI failure', () => {
    expect(hasNonReviewFailingChecks(withChecks(['Status Checks']))).toBe(false)
  })

  it('treats real test failures as CI failures (#29850)', () => {
    expect(hasNonReviewFailingChecks(withChecks(['Test (Group 22)']))).toBe(true)
  })

  it('treats lint/security failures as CI failures (#29893)', () => {
    expect(hasNonReviewFailingChecks(withChecks(['Linting and Security']))).toBe(true)
  })

  // #29808: hyphenated team name — a review gate, not a CI failure.
  it('recognizes "Check for backend-review-group approval" as a review gate', () => {
    expect(hasNonReviewFailingChecks(withChecks(['Check for backend-review-group approval']))).toBe(
      false,
    )
  })
})

describe('needsFirstTeamReview', () => {
  const vetsApi = (over: Partial<PullRequest> = {}) =>
    base({ backend_approval_status: 'not_approved', ...over })

  it('includes a PR awaiting first review whose only failure is the approval gate', () => {
    expect(
      needsFirstTeamReview(
        vetsApi({
          pending_teams: ['benefits-non-disability'],
          ci_status: 'failure',
          failing_checks: [{ name: 'Status Checks' }] as never,
        }),
      ),
    ).toBe(true)
  })

  // A real CI failure doesn't get IN via the pending-review gate. (#29850 still
  // reaches this bucket through the trailing catch-all below, since it has no
  // approvals and no changes-requested — a pre-existing overlap with Failing CI
  // that this gate neither created nor fixes.) What's asserted here is that the
  // gate itself no longer admits it: with an approval present, the gate is the
  // only path that could have, and it declines.
  it('does not admit a real CI failure through the pending-review gate (#29850)', () => {
    expect(
      needsFirstTeamReview(
        vetsApi({
          pending_teams: ['mobile-api-team'],
          ci_status: 'failure',
          failing_checks: [{ name: 'Test (Group 22)' }] as never,
          approval_summary: { approved_count: 1, approved_users: ['someone'] } as never,
        }),
      ),
    ).toBe(false)
  })

  // Backend reviewers often approve before the owning team. A pending codeowner
  // team is still a required, blocking review, so the PR comes back here.
  it('includes a backend-approved PR still awaiting its codeowner team (#29627)', () => {
    expect(
      needsFirstTeamReview(
        base({
          pending_teams: ['govcio-vfep-codereviewers'],
          backend_approval_status: 'approved',
          approval_summary: { approved_count: 1, approved_users: ['Rachal-Cassity'] } as never,
        }),
      ),
    ).toBe(true)
  })
})

describe('needsDevOpsReview', () => {
  it('is true when vsp-operations is a pending team on an open PR', () => {
    expect(needsDevOpsReview(base({ pending_teams: ['vsp-operations'] }))).toBe(true)
  })

  it('is false once vsp-operations is no longer pending', () => {
    expect(needsDevOpsReview(base({ pending_teams: ['benefits-non-disability'] }))).toBe(false)
  })

  it('excludes drafts', () => {
    expect(needsDevOpsReview(base({ draft: true, pending_teams: ['vsp-operations'] }))).toBe(false)
  })

  it('excludes closed PRs', () => {
    expect(needsDevOpsReview(base({ state: 'closed', pending_teams: ['vsp-operations'] }))).toBe(false)
  })
})
