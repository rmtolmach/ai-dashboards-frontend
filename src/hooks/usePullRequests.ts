import { useEffect, useRef, useState, useCallback } from 'react'
import { authService } from '../services/auth'
import { subscribeToPullRequests } from '../services/actionCable'
import { mockApiResponse } from '../services/mockData'
import type { PullRequest, ApiResponse } from '../types/pull-request'

const USE_MOCK = import.meta.env.VITE_USE_MOCK_DATA === 'true'

interface UsePullRequestsResult {
  pullRequests: PullRequest[]
  loading: boolean
  error: string | null
  lastUpdated: string | null
  isUpdating: boolean
  refresh: () => void
}

export function usePullRequests(): UsePullRequestsResult {
  const [pullRequests, setPullRequests] = useState<PullRequest[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<string | null>(null)
  const [isUpdating, setIsUpdating] = useState(false)
  const lastUpdatedRef = useRef<string | null>(null)

  const fetchPRs = useCallback(async (isPolling = false) => {
    if (!isPolling) setLoading(true)
    try {
      let data: ApiResponse
      if (USE_MOCK) {
        await new Promise(r => setTimeout(r, isPolling ? 0 : 200)) // simulate latency
        data = mockApiResponse()
      } else {
        const controller = new AbortController()
        const timeout = setTimeout(() => controller.abort(), 30000)
        const response = await fetch(
          `${import.meta.env.VITE_API_URL || 'http://localhost:3000'}/api/v1/reviews`,
          { headers: { ...authService.getAuthHeaders() }, signal: controller.signal }
        )
        clearTimeout(timeout)
        if (response.status === 401 || response.status === 403) {
          authService.logout()
          return
        }
        if (!response.ok) throw new Error('Could not load PRs')
        data = await response.json()
      }
      setIsUpdating(data.updating || false)
      if (!isPolling || data.last_updated !== lastUpdatedRef.current) {
        const tracked = [...(data.pull_requests || []), ...(data.approved_pull_requests || [])]
        const trackedUrls = new Set(tracked.map(pr => pr.url))
        const devops = (data.devops_pull_requests || []).filter(pr => !trackedUrls.has(pr.url))
        const all = [...tracked, ...devops]
        setPullRequests(all)
        lastUpdatedRef.current = data.last_updated
        setLastUpdated(data.last_updated)
      }
      setError(null)
    } catch (err) {
      if (!isPolling) setError(err instanceof Error ? err.message : 'Could not load PRs')
    } finally {
      if (!isPolling) setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchPRs(false)
  }, [fetchPRs])

  useEffect(() => {
    const interval = isUpdating ? 5000 : 60000
    const timer = setInterval(() => fetchPRs(true), interval)
    return () => clearInterval(timer)
  }, [fetchPRs, isUpdating])

  useEffect(() => {
    if (USE_MOCK) return
    return subscribeToPullRequests(() => fetchPRs(true))
  }, [fetchPRs])

  return {
    pullRequests,
    loading,
    error,
    lastUpdated,
    isUpdating,
    refresh: () => fetchPRs(false),
  }
}
