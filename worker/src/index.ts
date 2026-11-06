import {
  atlasSchema,
  type Atlas,
  type RailConnection,
  type RouteGeometry,
  type TransportMode,
} from '../../shared/atlas'

type Env = {
  GITHUB_TOKEN: string
  GITHUB_REPO: string
  GITHUB_BRANCH: string
  ATLAS_PATH: string
  SITE_ORIGINS: string
  SESSION_SECRET: string
  EDITOR_KEYS: string
  EDITOR_KEYS_EXTRA?: string
  PUBLIC_ORIGIN?: string
  WAYPOINTS_KV?: KVNamespace
}

type EditorKey = {
  name: string
  salt: string
  hash: string
}

type Session = {
  sub: string
  exp: number
}

type RoutePoint = [number, number]

type Station = {
  name: string
  nameEn?: string
  lat: number
  lon: number
}

class HttpError extends Error {
  status: number
  code: string

  constructor(status: number, code: string, message: string) {
    super(message)
    this.status = status
    this.code = code
  }
}

const encoder = new TextEncoder()
const decoder = new TextDecoder()
const USER_AGENT = 'WaypointsAtlas/1.0 (+https://waypoints.derekhan.link)'
const GITHUB_API = 'https://api.github.com'
const TRANSITOUS_API = 'https://api.transitous.org/api/v6/plan'

function allowedOrigins(env: Env): string[] {
  return env.SITE_ORIGINS.split(',')
    .map((origin) => origin.trim())
    .filter(Boolean)
}

function corsHeaders(env: Env, origin: string | null): Headers {
  const headers = new Headers({
    'Access-Control-Allow-Methods': 'GET, POST, PUT, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, content-type',
    'Access-Control-Max-Age': '86400',
    Vary: 'Origin',
    'Cache-Control': 'no-store',
  })
  if (origin && allowedOrigins(env).includes(origin)) {
    headers.set('Access-Control-Allow-Origin', origin)
  }
  return headers
}

function isAllowedOrigin(env: Env, origin: string | null): boolean {
  if (!origin) return true
  return allowedOrigins(env).includes(origin)
}

function json(data: unknown, status: number, cors: Headers): Response {
  const headers = new Headers(cors)
  headers.set('Content-Type', 'application/json; charset=utf-8')
  headers.set('Cache-Control', 'no-store')
  headers.set('X-Content-Type-Options', 'nosniff')
  headers.set('Referrer-Policy', 'no-referrer')
  return new Response(JSON.stringify(data), { status, headers })
}

function errorJson(error: HttpError, cors: Headers): Response {
  return json({ error: { code: error.code, message: error.message } }, error.status, cors)
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  const text = await request.text()
  if (text.length > 900_000) throw new HttpError(413, 'too_large', 'Request body is too large')
  try {
    const value = JSON.parse(text)
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('not an object')
    }
    return value as Record<string, unknown>
  } catch {
    throw new HttpError(400, 'bad_json', 'Request body must be a JSON object')
  }
}

function bytesToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('')
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunk = 0x8000
  for (let index = 0; index < bytes.length; index += chunk) {
    binary += String.fromCharCode(...bytes.subarray(index, index + chunk))
  }
  return btoa(binary)
}

function bytesToBase64Url(bytes: Uint8Array): string {
  return bytesToBase64(bytes).replaceAll('+', '-').replaceAll('/', '_').replace(/=+$/, '')
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value.replace(/\s/g, ''))
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index)
  return bytes
}

function base64UrlToBytes(value: string): Uint8Array {
  const normalized = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4)
  return base64ToBytes(padded)
}

function base64UrlToString(value: string): string {
  return decoder.decode(base64UrlToBytes(value))
}

function utf8ToBase64(value: string): string {
  return bytesToBase64(encoder.encode(value))
}

function base64ToUtf8(value: string): string {
  return decoder.decode(base64ToBytes(value))
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', encoder.encode(value))
  return bytesToHex(new Uint8Array(digest))
}

async function hmac(secret: string, value: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  )
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(value))
  return bytesToBase64Url(new Uint8Array(signature))
}

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index += 1) {
    difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  }
  return difference === 0
}

function parseEditorKeys(raw: string | undefined, label: string): EditorKey[] {
  if (!raw) return []
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    throw new HttpError(500, 'server_error', `${label} is not valid JSON`)
  }
  if (!Array.isArray(parsed)) {
    throw new HttpError(500, 'server_error', `${label} must be an array`)
  }
  return parsed as EditorKey[]
}

async function verifyKey(env: Env, key: string): Promise<string | null> {
  const editors = [
    ...parseEditorKeys(env.EDITOR_KEYS, 'EDITOR_KEYS'),
    ...parseEditorKeys(env.EDITOR_KEYS_EXTRA, 'EDITOR_KEYS_EXTRA'),
  ]
  for (const editor of editors) {
    if (!editor?.salt || !editor?.hash || !editor?.name) continue
    const hash = await sha256Hex(`${editor.salt}${key}`)
    if (constantTimeEqual(hash, editor.hash)) return editor.name
  }
  return null
}

async function issueSession(env: Env, name: string): Promise<{ token: string; expiresAt: string }> {
  const expires = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  const payload = bytesToBase64Url(encoder.encode(JSON.stringify({ sub: name, exp: expires })))
  const signature = await hmac(env.SESSION_SECRET, payload)
  return {
    token: `${payload}.${signature}`,
    expiresAt: new Date(expires * 1000).toISOString(),
  }
}

async function verifySession(env: Env, token: string): Promise<Session | null> {
  const [payload, signature] = token.split('.')
  if (!payload || !signature) return null
  const expected = await hmac(env.SESSION_SECRET, payload)
  if (!constantTimeEqual(expected, signature)) return null
  try {
    const parsed = JSON.parse(base64UrlToString(payload)) as Session
    if (!parsed?.sub || typeof parsed.exp !== 'number') return null
    if (parsed.exp * 1000 < Date.now()) return null
    return parsed
  } catch {
    return null
  }
}

async function requireSession(request: Request, env: Env): Promise<Session> {
  const authorization = request.headers.get('Authorization') ?? ''
  const token = authorization.startsWith('Bearer ') ? authorization.slice(7).trim() : ''
  if (!token) throw new HttpError(401, 'unauthorized', 'A session token is required')
  const session = await verifySession(env, token)
  if (!session) throw new HttpError(401, 'invalid_session', 'The session is invalid or expired')
  return session
}

async function rateLimit(
  env: Env,
  key: string,
  limit: number,
  windowSeconds: number,
): Promise<boolean> {
  if (!env.WAYPOINTS_KV) return true
  const existing = Number.parseInt((await env.WAYPOINTS_KV.get(key)) ?? '0', 10) || 0
  if (existing >= limit) return false
  await env.WAYPOINTS_KV.put(key, String(existing + 1), { expirationTtl: windowSeconds })
  return true
}

async function resetRateLimit(env: Env, key: string): Promise<void> {
  if (env.WAYPOINTS_KV) await env.WAYPOINTS_KV.delete(key)
}

async function fetchWithTimeout(
  input: string,
  init: RequestInit,
  timeoutMs = 20_000,
): Promise<Response> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(input, { ...init, signal: controller.signal })
  } finally {
    clearTimeout(timer)
  }
}

function githubHeaders(env: Env): HeadersInit {
  return {
    Authorization: `Bearer ${env.GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': USER_AGENT,
  }
}

function encodedPath(path: string): string {
  return path
    .split('/')
    .filter(Boolean)
    .map((segment) => encodeURIComponent(segment))
    .join('/')
}

type RemoteFile = {
  sha: string
  atlas: Atlas
  text: string
}

async function getRemoteAtlas(env: Env): Promise<RemoteFile | null> {
  const url = `${GITHUB_API}/repos/${env.GITHUB_REPO}/contents/${encodedPath(env.ATLAS_PATH)}?ref=${encodeURIComponent(env.GITHUB_BRANCH)}`
  const response = await fetchWithTimeout(url, { headers: githubHeaders(env) })
  if (response.status === 404) return null
  if (!response.ok) {
    throw new HttpError(502, 'github_error', `GitHub returned ${response.status}`)
  }
  const data = (await response.json()) as { sha: string; content: string; encoding: string }
  if (!data.content) throw new HttpError(502, 'github_error', 'GitHub returned no file content')
  const text = data.encoding === 'base64' ? base64ToUtf8(data.content) : data.content
  try {
    const atlas = atlasSchema.parse(JSON.parse(text))
    return { sha: data.sha, atlas, text }
  } catch {
    throw new HttpError(502, 'invalid_remote', 'The atlas file in the repository is not valid')
  }
}

async function putRemoteAtlas(
  env: Env,
  text: string,
  sha: string | null,
  editor: string,
): Promise<{ sha: string; commitUrl?: string }> {
  const url = `${GITHUB_API}/repos/${env.GITHUB_REPO}/contents/${encodedPath(env.ATLAS_PATH)}`
  const body: Record<string, unknown> = {
    message: `Atlas update by ${editor}`,
    content: utf8ToBase64(text),
    branch: env.GITHUB_BRANCH,
  }
  if (sha) body.sha = sha
  const response = await fetchWithTimeout(
    url,
    {
      method: 'PUT',
      headers: { ...githubHeaders(env), 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    },
    30_000,
  )
  if (response.status === 409) {
    throw new HttpError(409, 'github_conflict', 'The file changed on GitHub')
  }
  if (!response.ok) {
    const message = await response.text().catch(() => '')
    console.error('GitHub write failed', response.status, message.slice(0, 300))
    throw new HttpError(502, 'github_error', `GitHub returned ${response.status}`)
  }
  const data = (await response.json()) as {
    content?: { sha?: string }
    commit?: { html_url?: string }
  }
  if (!data.content?.sha) throw new HttpError(502, 'github_error', 'GitHub did not return a file SHA')
  return { sha: data.content.sha, commitUrl: data.commit?.html_url }
}

function haversineKm(a: [number, number], b: [number, number]): number {
  const radius = 6371.0088
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

function vector([lon, lat]: RoutePoint): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return [
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ]
}

function pointSegmentDistance(point: RoutePoint, a: RoutePoint, b: RoutePoint): number {
  const p = vector(point)
  const av = vector(a)
  const bv = vector(b)
  const ab = [bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]]
  const ap = [p[0] - av[0], p[1] - av[1], p[2] - av[2]]
  const denominator = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const t =
    denominator === 0
      ? 0
      : Math.max(
          0,
          Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denominator),
        )
  const closest = [av[0] + ab[0] * t, av[1] + ab[1] * t, av[2] + ab[2] * t]
  return Math.hypot(p[0] - closest[0], p[1] - closest[1], p[2] - closest[2])
}

function simplify(points: RoutePoint[], tolerance = 0.00025, maxPoints = 500): RoutePoint[] {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack: Array<[number, number]> = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop() as [number, number]
    let maxDistance = 0
    let index = -1
    for (let cursor = start + 1; cursor < end; cursor += 1) {
      const distance = pointSegmentDistance(points[cursor], points[start], points[end])
      if (distance > maxDistance) {
        maxDistance = distance
        index = cursor
      }
    }
    if (maxDistance > tolerance && index !== -1) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  let result = points.filter((_, index) => keep[index] === 1)
  if (result.length > maxPoints) {
    const step = (result.length - 1) / (maxPoints - 1)
    result = Array.from({ length: maxPoints }, (_, index) => result[Math.round(index * step)])
  }
  return result.map(([lon, lat]) => [
    Math.round(lon * 10000) / 10000,
    Math.round(lat * 10000) / 10000,
  ])
}

function validatePoint(value: unknown): { lat: number; lon: number; name?: string } {
  if (!value || typeof value !== 'object') throw new HttpError(400, 'bad_point', 'Invalid point')
  const point = value as Record<string, unknown>
  const lat = Number(point.lat)
  const lon = Number(point.lon)
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) {
    throw new HttpError(400, 'bad_point', 'Latitude must be between -90 and 90')
  }
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) {
    throw new HttpError(400, 'bad_point', 'Longitude must be between -180 and 180')
  }
  return {
    lat,
    lon,
    ...(typeof point.name === 'string' ? { name: point.name.slice(0, 160) } : {}),
  }
}

async function orsRoute(
  env: Env,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<{ distance: number; points: RoutePoint[] }> {
  const url = new URL('https://routing.openrailrouting.org/route')
  url.searchParams.append('point', `${from.lat},${from.lon}`)
  url.searchParams.append('point', `${to.lat},${to.lon}`)
  url.searchParams.set('profile', 'all_tracks')
  url.searchParams.set('points_encoded', 'false')
  url.searchParams.set('type', 'json')
  url.searchParams.set('locale', 'en')
  url.searchParams.set('calc_points', 'true')
  url.searchParams.set('instructions', 'false')
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: env.PUBLIC_ORIGIN ?? 'https://waypoints.derekhan.link/',
      Accept: 'application/json',
    },
  })
  if (!response.ok) {
    throw new HttpError(
      response.status === 400 ? 422 : 502,
      'route_unavailable',
      `Rail routing returned ${response.status}`,
    )
  }
  const data = (await response.json()) as {
    paths?: Array<{ distance?: number; points?: { coordinates?: RoutePoint[] } }>
  }
  const path = data.paths?.[0]
  const coordinates = path?.points?.coordinates
  if (!path || !coordinates?.length) {
    throw new HttpError(422, 'route_unavailable', 'No rail path was found')
  }
  return { distance: path.distance ?? 0, points: coordinates }
}

async function osrmRoute(
  env: Env,
  mode: TransportMode,
  from: { lat: number; lon: number },
  to: { lat: number; lon: number },
): Promise<RouteGeometry> {
  const profile = mode === 'bike' ? 'bike' : mode === 'walk' ? 'foot' : 'driving'
  const url = `https://router.project-osrm.org/route/v1/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`
  const response = await fetchWithTimeout(url, {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: env.PUBLIC_ORIGIN ?? 'https://waypoints.derekhan.link/',
      'X-Client-Id': 'waypoints.derekhan.link',
      Accept: 'application/json',
    },
  })
  if (!response.ok) throw new HttpError(502, 'road_error', `Road routing returned ${response.status}`)
  const data = (await response.json()) as {
    routes?: Array<{ distance?: number; geometry?: { coordinates?: RoutePoint[] } }>
  }
  const route = data.routes?.[0]
  const coordinates = route?.geometry?.coordinates
  if (!route || !coordinates?.length) {
    throw new HttpError(422, 'route_unavailable', 'No road path was found')
  }
  return {
    provider: 'osrm',
    points: simplify(coordinates),
    distanceKm: Math.round(((route.distance ?? 0) / 1000) * 10) / 10,
    status: 'routed',
  }
}

const CJK = /[\u3400-\u9fff]/
const EXCLUDED_STATION_TYPES = new Set([
  'subway',
  'light_rail',
  'monorail',
  'tram',
  'funicular',
])

function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/站|车站|火车站|railway|station/g, '')
    .replace(/[\s·・.,'’()（）\-_/]/g, '')
    .replace(/市$/, '')
}

function chooseStation(
  candidates: Station[],
  target: { name?: string; lat: number; lon: number },
): Station | null {
  let best: { station: Station; score: number } | null = null
  const targetName = target.name ? normaliseName(target.name) : ''
  for (const station of candidates) {
    const distance = haversineKm([target.lon, target.lat], [station.lon, station.lat])
    if (distance > 60) continue
    const names = [station.name, station.nameEn]
      .filter((name): name is string => Boolean(name))
      .map(normaliseName)
    const nameMatch =
      Boolean(targetName) &&
      names.some(
        (name) =>
          Boolean(name) &&
          (name.includes(targetName) || targetName.includes(name)),
      )
    const score = distance - (nameMatch ? 10 : 0)
    if (!best || score < best.score) best = { station, score }
  }
  return best?.station ?? null
}

async function photonStations(query: string): Promise<Station[]> {
  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', query)
  url.searchParams.set('limit', '10')
  url.searchParams.set('osm_tag', 'railway:station')
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://waypoints.derekhan.link/',
      Accept: 'application/json',
    },
  })
  if (!response.ok) return []
  const data = (await response.json()) as {
    features?: Array<{
      geometry?: { coordinates?: [number, number] }
      properties?: Record<string, unknown>
    }>
  }
  const stations: Station[] = []
  for (const feature of data.features ?? []) {
    const coordinates = feature.geometry?.coordinates
    const properties = feature.properties ?? {}
    if (!coordinates || properties.osm_key !== 'railway' || properties.osm_value !== 'station') {
      continue
    }
    const name = typeof properties.name === 'string' ? properties.name : ''
    if (!name) continue
    const nameEn =
      typeof properties['name:en'] === 'string' ? (properties['name:en'] as string) : undefined
    stations.push({ name, nameEn, lat: coordinates[1], lon: coordinates[0] })
  }
  return stations
}

async function openRailwayMapStations(query: string): Promise<Station[]> {
  const url = new URL('https://api.openrailwaymap.org/v2/facility')
  url.searchParams.set('name', query)
  url.searchParams.set('limit', '100')
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: 'https://waypoints.derekhan.link/',
      Accept: 'application/json',
    },
  })
  if (!response.ok) return []
  const data = (await response.json()) as Array<{
    name?: string
    'name:en'?: string
    latitude?: number
    longitude?: number
    railway?: string
    station?: string
    subway?: string
    tram?: string
  }>
  const stations: Station[] = []
  for (const item of data) {
    if (!item?.name || typeof item.latitude !== 'number' || typeof item.longitude !== 'number') {
      continue
    }
    if (item.railway !== 'station') continue
    if (item.subway === 'yes' || item.tram === 'yes') continue
    if (EXCLUDED_STATION_TYPES.has(item.station ?? '')) continue
    stations.push({
      name: item.name,
      nameEn: item['name:en'],
      lat: item.latitude,
      lon: item.longitude,
    })
  }
  return stations
}

async function resolveStation(
  env: Env,
  point: { lat: number; lon: number; name?: string },
): Promise<Station | null> {
  const name = point.name?.trim() ?? ''
  if (!name) return null
  const cacheKey = `station:v3:${point.lat.toFixed(2)},${point.lon.toFixed(2)}:${name}`
  if (env.WAYPOINTS_KV) {
    const cached = (await env.WAYPOINTS_KV.get(cacheKey, 'json')) as Station | null
    if (cached) return cached
  }

  const cleanName = name.replace(/\s+(railway station|station)$/i, '').trim()
  let candidates: Station[] = []
  try {
    candidates = await openRailwayMapStations(cleanName)
    if (!candidates.length) {
      candidates = await photonStations(
        CJK.test(cleanName) ? `${cleanName} 火车站` : `${cleanName} railway station`,
      )
    }
  } catch (error) {
    console.warn('Station lookup failed', error)
  }
  const station = chooseStation(candidates, point)
  if (station && env.WAYPOINTS_KV) {
    await env.WAYPOINTS_KV.put(cacheKey, JSON.stringify(station), {
      expirationTtl: 60 * 60 * 24 * 30,
    })
  }
  return station
}

async function resolveStations(
  env: Env,
  from: { lat: number; lon: number; name?: string },
  to: { lat: number; lon: number; name?: string },
): Promise<{ from: Station | null; to: Station | null }> {
  const [fromStation, toStation] = await Promise.all([
    resolveStation(env, from),
    resolveStation(env, to),
  ])
  return { from: fromStation, to: toStation }
}

async function trainRoute(
  env: Env,
  from: { lat: number; lon: number; name?: string },
  to: { lat: number; lon: number; name?: string },
): Promise<RouteGeometry> {
  const stations = await resolveStations(env, from, to)
  let path: { distance: number; points: RoutePoint[] } | null = null
  let usedStations = false
  if (stations.from && stations.to) {
    try {
      path = await orsRoute(env, stations.from, stations.to)
      usedStations = true
    } catch (error) {
      console.warn('Station rail route failed', error)
    }
  }
  if (!path) {
    path = await orsRoute(env, from, to)
  }
  if (!path) throw new HttpError(422, 'route_unavailable', 'No rail path was found')

  let points = path.points
  let distance = path.distance / 1000
  if (usedStations && stations.from && stations.to) {
    const fromConnector = haversineKm([from.lon, from.lat], [stations.from.lon, stations.from.lat])
    const toConnector = haversineKm([to.lon, to.lat], [stations.to.lon, stations.to.lat])
    distance += fromConnector + toConnector
    points = [[from.lon, from.lat], ...points, [to.lon, to.lat]]
  }
  return {
    provider: 'openrailrouting',
    points: simplify(points),
    distanceKm: Math.round(distance * 10) / 10,
    status: 'routed',
  }
}

async function getCachedRoute(env: Env, key: string): Promise<RouteGeometry | null> {
  if (!env.WAYPOINTS_KV) return null
  return (await env.WAYPOINTS_KV.get(key, 'json')) as RouteGeometry | null
}

async function cacheRoute(env: Env, key: string, route: RouteGeometry): Promise<void> {
  if (!env.WAYPOINTS_KV) return
  await env.WAYPOINTS_KV.put(key, JSON.stringify(route), { expirationTtl: 60 * 60 * 24 * 30 })
}

function formatTimeInZone(iso: string, timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
      timeZone,
    }).format(new Date(iso))
  } catch {
    return new Date(iso).toISOString().slice(11, 16)
  }
}

type TransitLeg = {
  mode?: string
  displayName?: string | null
  routeShortName?: string | null
  startTime?: string
  endTime?: string
  from?: { name?: string | null }
  to?: { name?: string | null }
}

type TransitItinerary = {
  startTime?: string
  endTime?: string
  duration?: number
  transfers?: number
  legs?: TransitLeg[]
}

const WALKING_MODES = new Set(['WALK', 'BIKE', 'CAR', 'RENTAL', 'RENTAL_BICYCLE', 'RENTAL_CAR'])

async function railConnections(
  env: Env,
  body: Record<string, unknown>,
): Promise<RailConnection[]> {
  const from = validatePoint(body.from)
  const to = validatePoint(body.to)
  const time = typeof body.time === 'string' ? body.time : ''
  const serviceDate = typeof body.serviceDate === 'string' ? body.serviceDate.slice(0, 20) : ''
  const timezone = typeof body.timezone === 'string' ? body.timezone : 'UTC'
  const arriveTimezone =
    typeof body.arriveTimezone === 'string' ? body.arriveTimezone : timezone
  if (!time || !serviceDate) {
    throw new HttpError(400, 'bad_time', 'A date and time are required')
  }
  const cacheKey = `rail:v1:${from.lat.toFixed(3)},${from.lon.toFixed(3)}:${to.lat.toFixed(3)},${to.lon.toFixed(3)}:${time}:${timezone}:${arriveTimezone}`
  if (env.WAYPOINTS_KV) {
    const cached = await env.WAYPOINTS_KV.get(cacheKey, 'json')
    if (cached) return cached as RailConnection[]
  }

  // Query station-to-station where possible. City-centre coordinates often
  // pull in a local metro or bus tail that is not part of the rail journey.
  const stations = await resolveStations(env, from, to)
  const queryFrom = stations.from ?? from
  const queryTo = stations.to ?? to
  const url = new URL(TRANSITOUS_API)
  url.searchParams.set('fromPlace', `${queryFrom.lat},${queryFrom.lon}`)
  url.searchParams.set('toPlace', `${queryTo.lat},${queryTo.lon}`)
  url.searchParams.set('time', time)
  url.searchParams.set('numItineraries', '3')
  url.searchParams.set('maxTransfers', '6')
  const response = await fetchWithTimeout(url.toString(), {
    headers: {
      'User-Agent': USER_AGENT,
      Referer: env.PUBLIC_ORIGIN ?? 'https://waypoints.derekhan.link/',
      Accept: 'application/json',
    },
  })
  if (response.status === 400) {
    // Outside timetable coverage or a time the feed cannot answer.
    return []
  }
  if (!response.ok) {
    throw new HttpError(502, 'transit_error', `Timetable service returned ${response.status}`)
  }
  const data = (await response.json()) as { itineraries?: TransitItinerary[] }
  const results: RailConnection[] = []
  const seen = new Set<string>()
  for (const itinerary of data.itineraries ?? []) {
    if (!itinerary.startTime || !itinerary.endTime) continue
    const legs = (itinerary.legs ?? []).filter(
      (leg) => leg.mode && !WALKING_MODES.has(leg.mode) && leg.from?.name && leg.to?.name,
    )
    if (!legs.length) continue
    const namedLegs = legs.filter((leg) => {
      const line = (leg.displayName || leg.routeShortName || '').trim()
      return Boolean(line) && !/^\d+$/.test(line)
    })
    const mainLegs = namedLegs.length ? namedLegs : legs
    const first = mainLegs[0]
    const last = mainLegs[mainLegs.length - 1]
    const departure = first.startTime ?? itinerary.startTime
    const arrival = last.endTime ?? itinerary.endTime
    const lines = mainLegs
      .map((leg) => leg.displayName || leg.routeShortName)
      .filter((line): line is string => Boolean(line))
    const summary = lines.length
      ? `${lines.slice(0, 2).join(' · ')}${lines.length > 2 ? ' …' : ''}`
      : `${from.name ?? ''} → ${to.name ?? ''}`.trim()
    const depart = formatTimeInZone(departure, timezone)
    const arrive = formatTimeInZone(arrival, arriveTimezone)
    const durationMs = Date.parse(arrival) - Date.parse(departure)
    const durationMinutes =
      Number.isFinite(durationMs) && durationMs > 0
        ? Math.round(durationMs / 60_000)
        : itinerary.duration
          ? Math.round(itinerary.duration / 60)
          : undefined
    const transfers = Math.max(0, mainLegs.length - 1)
    const dedupeKey = `${summary}|${depart}|${arrive}|${transfers}`
    if (seen.has(dedupeKey)) continue
    seen.add(dedupeKey)
    results.push({
      provider: 'transitous',
      serviceDate,
      timezone,
      arriveTimezone,
      depart,
      arrive,
      durationMinutes,
      transfers,
      summary: summary || 'Rail connection',
      segments: mainLegs.map((leg) => ({
        mode: (leg.mode ?? 'RAIL').slice(0, 40),
        ...(leg.displayName || leg.routeShortName
          ? { line: (leg.displayName || leg.routeShortName || '').slice(0, 120) }
          : {}),
        from: (leg.from?.name ?? '').slice(0, 160),
        to: (leg.to?.name ?? '').slice(0, 160),
        depart: leg.startTime ? formatTimeInZone(leg.startTime, timezone) : '',
        arrive: leg.endTime ? formatTimeInZone(leg.endTime, timezone) : '',
      })),
      checkedAt: new Date().toISOString(),
    })
  }
  if (env.WAYPOINTS_KV && results.length) {
    await env.WAYPOINTS_KV.put(cacheKey, JSON.stringify(results), { expirationTtl: 60 * 30 })
  }
  return results
}

function requireSecrets(env: Env): void {
  if (!env.SESSION_SECRET) {
    throw new HttpError(500, 'server_error', 'SESSION_SECRET is not configured')
  }
  if (!env.EDITOR_KEYS) {
    throw new HttpError(500, 'server_error', 'EDITOR_KEYS is not configured')
  }
}

function requireGithub(env: Env): void {
  if (!env.GITHUB_TOKEN || !env.GITHUB_REPO || !env.GITHUB_BRANCH || !env.ATLAS_PATH) {
    throw new HttpError(500, 'server_error', 'GitHub repository settings are incomplete')
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const origin = request.headers.get('Origin')
    const cors = corsHeaders(env, origin)
    if (!isAllowedOrigin(env, origin)) {
      return json({ error: { code: 'origin', message: 'Origin is not allowed' } }, 403, cors)
    }
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: cors })
    }

    const url = new URL(request.url)
    const path = url.pathname.replace(/\/+$/, '') || '/'

    try {
      if (path === '/api/health' && request.method === 'GET') {
        return json({ ok: true }, 200, cors)
      }

      if (path === '/api/session' && request.method === 'POST') {
        requireSecrets(env)
        const ip = request.headers.get('CF-Connecting-IP') ?? 'unknown'
        const loginKey = `login:${await sha256Hex(`${ip}:${(env.SESSION_SECRET ?? '').slice(0, 12)}`)}`
        if (!(await rateLimit(env, loginKey, 10, 900))) {
          throw new HttpError(429, 'rate_limited', 'Too many attempts; try again later')
        }
        const body = await readJson(request)
        const key = typeof body.key === 'string' ? body.key.trim() : ''
        if (!key || key.length > 300) {
          throw new HttpError(401, 'invalid_key', 'That key was not recognised')
        }
        const editor = await verifyKey(env, key)
        if (!editor) {
          throw new HttpError(401, 'invalid_key', 'That key was not recognised')
        }
        await resetRateLimit(env, loginKey)
        const session = await issueSession(env, editor)
        return json({ ...session, editor }, 200, cors)
      }

      if (path === '/api/atlas' && request.method === 'GET') {
        requireSecrets(env)
        requireGithub(env)
        await requireSession(request, env)
        const remote = await getRemoteAtlas(env)
        if (!remote) throw new HttpError(404, 'not_found', 'The atlas file does not exist yet')
        return json({ atlas: remote.atlas, sha: remote.sha }, 200, cors)
      }

      if (path === '/api/atlas' && request.method === 'PUT') {
        requireSecrets(env)
        requireGithub(env)
        const session = await requireSession(request, env)
        if (!(await rateLimit(env, `save:${session.sub}`, 60, 3600))) {
          throw new HttpError(429, 'rate_limited', 'Too many saves; try again later')
        }
        const body = await readJson(request)
        let atlas: Atlas
        try {
          atlas = atlasSchema.parse(body.atlas)
        } catch {
          throw new HttpError(422, 'invalid_atlas', 'The atlas data is not valid')
        }
        const force = body.force === true
        const baseSha = typeof body.baseSha === 'string' ? body.baseSha : null
        const current = await getRemoteAtlas(env)
        if (!force && (current?.sha ?? null) !== baseSha) {
          if (current) {
            return json(
              {
                error: {
                  code: 'conflict',
                  message: 'The atlas changed since you loaded it',
                },
                atlas: current.atlas,
                sha: current.sha,
              },
              409,
              cors,
            )
          }
          throw new HttpError(409, 'conflict', 'The atlas changed since you loaded it')
        }
        const savedAtlas: Atlas = {
          ...atlas,
          updatedAt: new Date().toISOString(),
          lastEditedBy: session.sub,
        }
        const text = `${JSON.stringify(savedAtlas, null, 2)}\n`
        try {
          const result = await putRemoteAtlas(env, text, current?.sha ?? null, session.sub)
          return json(
            {
              atlas: savedAtlas,
              sha: result.sha,
              ...(result.commitUrl ? { commitUrl: result.commitUrl } : {}),
            },
            200,
            cors,
          )
        } catch (error) {
          if (error instanceof HttpError && error.code === 'github_conflict') {
            const latest = await getRemoteAtlas(env)
            if (latest) {
              return json(
                {
                  error: { code: 'conflict', message: 'The atlas changed while saving' },
                  atlas: latest.atlas,
                  sha: latest.sha,
                },
                409,
                cors,
              )
            }
          }
          throw error
        }
      }

      if (path === '/api/route' && request.method === 'POST') {
        requireSecrets(env)
        const session = await requireSession(request, env)
        if (!(await rateLimit(env, `route:${session.sub}`, 120, 3600))) {
          throw new HttpError(429, 'rate_limited', 'Too many routing requests; try again later')
        }
        const body = await readJson(request)
        const mode = body.mode as TransportMode
        if (!['plane', 'train', 'car', 'bus', 'ferry', 'bike', 'walk'].includes(mode)) {
          throw new HttpError(400, 'bad_mode', 'Unknown transport mode')
        }
        const from = validatePoint(body.from)
        const to = validatePoint(body.to)
        if (mode === 'plane' || mode === 'ferry') {
          const distance = haversineKm([from.lon, from.lat], [to.lon, to.lat])
          return json(
            {
              provider: mode === 'plane' ? 'great-circle' : 'schematic',
              distanceKm: Math.round(distance * 10) / 10,
              status: mode === 'plane' ? 'routed' : 'estimated',
            },
            200,
            cors,
          )
        }
        const key = `route:v3:${mode}:${from.lat.toFixed(3)},${from.lon.toFixed(3)}:${to.lat.toFixed(3)},${to.lon.toFixed(3)}`
        const cached = await getCachedRoute(env, key)
        if (cached) return json(cached, 200, cors)
        const route =
          mode === 'train'
            ? await trainRoute(env, from, to)
            : await osrmRoute(env, mode, from, to)
        await cacheRoute(env, key, route)
        return json(route, 200, cors)
      }

      if (path === '/api/rail-connections' && request.method === 'POST') {
        requireSecrets(env)
        const session = await requireSession(request, env)
        if (!(await rateLimit(env, `rail:${session.sub}`, 60, 3600))) {
          throw new HttpError(429, 'rate_limited', 'Too many timetable requests; try again later')
        }
        const body = await readJson(request)
        const connections = await railConnections(env, body)
        return json({ connections }, 200, cors)
      }

      throw new HttpError(404, 'not_found', 'Not found')
    } catch (error) {
      if (error instanceof HttpError) return errorJson(error, cors)
      console.error('Unhandled worker error', error)
      return errorJson(new HttpError(500, 'server_error', 'Unexpected server error'), cors)
    }
  },
}
