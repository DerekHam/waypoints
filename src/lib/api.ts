import type { Atlas, RailConnection, RouteGeometry, TransportMode } from '@shared/atlas'
import { siteConfig } from '@/config'
import { zonedIso } from '@/lib/geo'

export class ApiError extends Error {
  status: number
  code: string

  constructor(message: string, status = 0, code = 'network') {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
  }
}

export class ConflictError extends ApiError {
  remote: Atlas
  remoteSha: string

  constructor(message: string, remote: Atlas, remoteSha: string) {
    super(message, 409, 'conflict')
    this.name = 'ConflictError'
    this.remote = remote
    this.remoteSha = remoteSha
  }
}

export type SessionResponse = {
  token: string
  editor: string
  expiresAt: string
}

export type AtlasResponse = {
  atlas: Atlas
  sha: string
}

export type SaveResponse = AtlasResponse & {
  commitUrl?: string
}

export type RouteResponse = RouteGeometry

export type ConnectionOption = Omit<RailConnection, 'checkedAt' | 'provider'> & {
  provider?: 'transitous'
}

type RequestOptions = {
  token?: string
  body?: unknown
  method?: 'GET' | 'POST' | 'PUT'
  timeoutMs?: number
}

function apiUrl(path: string): string {
  if (!siteConfig.apiBase) {
    throw new ApiError('The editing relay is not configured', 0, 'not_configured')
  }
  return `${siteConfig.apiBase}${path}`
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), options.timeoutMs ?? 20_000)
  try {
    const response = await fetch(apiUrl(path), {
      method: options.method ?? 'GET',
      headers: {
        Accept: 'application/json',
        ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(options.token ? { Authorization: `Bearer ${options.token}` } : {}),
      },
      body: options.body ? JSON.stringify(options.body) : undefined,
      signal: controller.signal,
      cache: 'no-store',
    })
    const data = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const error = (data.error ?? {}) as { code?: string; message?: string }
      if (response.status === 409 && data.atlas) {
        throw new ConflictError(
          error.message ?? 'Someone else saved first',
          data.atlas as Atlas,
          String(data.sha ?? ''),
        )
      }
      throw new ApiError(
        error.message ?? `Request failed (${response.status})`,
        response.status,
        error.code ?? 'request_failed',
      )
    }
    return data as T
  } catch (error) {
    if (error instanceof ApiError) throw error
    if (error instanceof DOMException && error.name === 'AbortError') {
      throw new ApiError('The relay took too long to respond', 0, 'timeout')
    }
    throw new ApiError('Could not reach the editing relay', 0, 'network')
  } finally {
    window.clearTimeout(timeout)
  }
}

export async function loginWithKey(key: string): Promise<SessionResponse> {
  return request<SessionResponse>('/api/session', {
    method: 'POST',
    body: { key },
  })
}

export async function fetchAtlas(token: string): Promise<AtlasResponse> {
  return request<AtlasResponse>('/api/atlas', { token })
}

export async function saveAtlas(
  token: string,
  atlas: Atlas,
  baseSha: string | null,
  force = false,
): Promise<SaveResponse> {
  return request<SaveResponse>('/api/atlas', {
    method: 'PUT',
    token,
    body: { atlas, baseSha, force },
    timeoutMs: 40_000,
  })
}

export async function computeRoute(
  token: string,
  mode: TransportMode,
  from: { lat: number; lon: number; name?: string },
  to: { lat: number; lon: number; name?: string },
): Promise<RouteResponse> {
  return request<RouteResponse>('/api/route', {
    method: 'POST',
    token,
    body: { mode, from, to },
    timeoutMs: 45_000,
  })
}

export async function findRailConnections(
  token: string,
  from: { lat: number; lon: number; name?: string },
  to: { lat: number; lon: number; name?: string },
  date: string,
  time: string,
  timezone: string,
  arriveTimezone: string,
): Promise<{ connections: ConnectionOption[] }> {
  return request<{ connections: ConnectionOption[] }>('/api/rail-connections', {
    method: 'POST',
    token,
    body: {
      from,
      to,
      time: zonedIso(date, time, timezone),
      serviceDate: date,
      timezone,
      arriveTimezone,
    },
    timeoutMs: 45_000,
  })
}
