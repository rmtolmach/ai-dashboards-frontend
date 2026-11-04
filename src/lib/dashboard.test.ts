import { describe, it, expect } from 'vitest'
import { FILTERS, classifyStatus, countByFilter } from './dashboard'
import type { PullRequest } from '../types/pull-request'

const base = (over: Partial<PullRequest> = {}): PullRequest =>
  ({
    number: 1,
    title: 't',
    author: 'a',
    url: 'https://va.ghe.com/software/devops/pull/1',
    state: 'open',
    draft: false,
    ci_status: 'success',
    backend_approval_status: 'not_approved',
    repository_name: 'devops',
    labels: [],
    failing_checks: [],
    pending_reviewers: [],
    pending_teams: ['vsp-operations'],
    ...over,
  }) as unknown as PullRequest

describe('DevOps Open isolation', () => {
  it('shows a PR awaiting vsp-operations only in DevOps Open', () => {
    const matching = FILTERS.filter(f => f.predicate(base())).map(f => f.key)
    expect(matching).toEqual(['devops'])
  })

  it('keeps DevOps dependabot PRs out of BE Dependabot', () => {
    const counts = countByFilter([base({ author: 'dependabot[bot]' })])
    expect(counts.dependabot).toBe(0)
    expect(counts.devops).toBe(1)
  })

  it('keeps DevOps failing-CI PRs out of Failing CI', () => {
    const counts = countByFilter([
      base({ ci_status: 'failure', failing_checks: [{ name: 'lint', status: 'failure', url: '' }] }),
    ])
    expect(counts.failing).toBe(0)
    expect(counts.all).toBe(0)
    expect(counts.devops).toBe(1)
  })
})

describe('classifyStatus for DevOps PRs', () => {
  it('reads Awaiting DevOps when CI is green', () => {
    expect(classifyStatus(base()).label).toBe('Awaiting DevOps')
  })

  it('still surfaces real CI failures', () => {
    const pr = base({ ci_status: 'failure', failing_checks: [{ name: 'lint', status: 'failure', url: '' }] })
    expect(classifyStatus(pr).label).toBe('1 failing')
  })
})
