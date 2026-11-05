import tzLookup from 'tz-lookup'
import type { Journey, Leg, Locale, Stop } from '@shared/atlas'

export function haversineKm(a: [number, number], b: [number, number]): number {
  const R = 6371.0088
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** [lon, lat] to the same spherical coordinates used by three.js SphereGeometry. */
export function latLonToVector3(lat: number, lon: number, radius = 1): [number, number, number] {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return [
    -radius * Math.sin(phi) * Math.cos(theta),
    radius * Math.cos(phi),
    radius * Math.sin(phi) * Math.sin(theta),
  ]
}

export function vector3ToLatLon(x: number, y: number, z: number): [number, number] {
  const radius = Math.hypot(x, y, z) || 1
  const lat = 90 - (Math.acos(y / radius) * 180) / Math.PI
  const theta = Math.atan2(z, -x)
  let lon = (theta * 180) / Math.PI - 180
  if (lon < -180) lon += 360
  if (lon > 180) lon -= 360
  return [lat, lon]
}

export function legDistanceKm(leg: Leg, from: Stop, to: Stop): number {
  if (leg.route?.distanceKm && leg.route.distanceKm > 0) return leg.route.distanceKm
  return haversineKm([from.lon, from.lat], [to.lon, to.lat])
}

export function journeyDistanceKm(journey: Journey): number {
  let total = 0
  for (let i = 0; i < journey.legs.length; i += 1) {
    const from = journey.stops[i]
    const to = journey.stops[i + 1]
    if (!from || !to) continue
    total += legDistanceKm(journey.legs[i], from, to)
  }
  return total
}

export function formatNumber(value: number, locale: Locale, maximumFractionDigits = 0): string {
  return new Intl.NumberFormat(locale === 'zh' ? 'zh-CN' : 'en-US', {
    maximumFractionDigits,
  }).format(value)
}

export function formatDistance(km: number, locale: Locale): string {
  if (!Number.isFinite(km) || km <= 0) return '—'
  const digits = km < 100 ? 1 : 0
  const value = formatNumber(km, locale, digits)
  return locale === 'zh' ? `${value} 公里` : `${value} km`
}

export function formatDate(date: string | undefined, locale: Locale, withYear = true): string {
  if (!date) return ''
  const parsed = new Date(`${date}T12:00:00`)
  if (Number.isNaN(parsed.getTime())) return date
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  }).format(parsed)
}

export function formatDateRange(
  from: string | undefined,
  to: string | undefined,
  locale: Locale,
): string {
  if (!from && !to) return ''
  if (from && to) {
    const sameYear = from.slice(0, 4) === to.slice(0, 4)
    const sameMonth = sameYear && from.slice(5, 7) === to.slice(5, 7)
    if (locale === 'zh' && sameYear) {
      const [year, month, day] = from.split('-').map(Number)
      const [, endMonth, endDay] = to.split('-').map(Number)
      if (sameMonth) return `${year}年${month}月${day}–${endDay}日`
      return `${year}年${month}月${day}日 – ${endMonth}月${endDay}日`
    }
    if (sameMonth) {
      const end = formatDate(to, locale, false)
      return `${formatDate(from, locale, false)} – ${end}, ${from.slice(0, 4)}`
    }
    return `${formatDate(from, locale)} – ${formatDate(to, locale)}`
  }
  return formatDate(from || to, locale)
}

export function formatTimestamp(iso: string | undefined, locale: Locale): string {
  if (!iso) return ''
  const parsed = new Date(iso)
  if (Number.isNaN(parsed.getTime())) return ''
  return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  }).format(parsed)
}

export function nightsBetween(arrive?: string, depart?: string): number | null {
  if (!arrive || !depart) return null
  const start = Date.parse(`${arrive}T12:00:00Z`)
  const end = Date.parse(`${depart}T12:00:00Z`)
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null
  return Math.round((end - start) / 86_400_000)
}

export function timezoneFor(lat: number, lon: number): string {
  try {
    // tz-lookup ships as CommonJS; Vite handles the default interop.
    return tzLookup(lat, lon) || 'UTC'
  } catch {
    return 'UTC'
  }
}

/**
 * Convert a wall-clock date/time in an IANA timezone into an ISO string with
 * the correct offset, which is what the MOTIS API accepts.
 */
export function zonedIso(date: string, time: string, timeZone: string): string {
  const guess = new Date(`${date}T${time || '09:00'}:00Z`)
  if (Number.isNaN(guess.getTime())) return `${date}T${time || '09:00'}:00Z`
  const offset = offsetFor(guess, timeZone)
  return `${date}T${time || '09:00'}:00${offset}`
}

function offsetFor(date: Date, timeZone: string): string {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      timeZoneName: 'longOffset',
    }).formatToParts(date)
    const raw = parts.find((part) => part.type === 'timeZoneName')?.value ?? 'GMT+00:00'
    if (raw === 'GMT' || raw === 'UTC') return '+00:00'
    const match = raw.match(/GMT([+-])(\d{1,2})(?::(\d{2}))?/)
    if (!match) return '+00:00'
    return `${match[1]}${match[2].padStart(2, '0')}:${match[3] ?? '00'}`
  } catch {
    return '+00:00'
  }
}

export function formatTime(iso: string, timeZone: string, locale: Locale): string {
  try {
    return new Intl.DateTimeFormat(locale === 'zh' ? 'zh-CN' : 'en-GB', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
      timeZone,
    }).format(new Date(iso))
  } catch {
    return ''
  }
}

export function formatDuration(minutes: number | undefined, locale: Locale): string {
  if (!minutes || minutes <= 0) return ''
  const hours = Math.floor(minutes / 60)
  const mins = Math.round(minutes % 60)
  if (locale === 'zh') {
    if (hours && mins) return `${hours} 小时 ${mins} 分`
    if (hours) return `${hours} 小时`
    return `${mins} 分钟`
  }
  if (hours && mins) return `${hours}h ${mins}m`
  if (hours) return `${hours}h`
  return `${mins}m`
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value))
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;')
}

export function downloadText(filename: string, text: string, type = 'application/json'): void {
  const blob = new Blob([text], { type })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
