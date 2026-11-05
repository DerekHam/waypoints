import type { Locale } from '@shared/atlas'

export type PlaceResult = {
  id: string
  name: string
  nameZh?: string
  region?: string
  regionZh?: string
  country?: string
  countryZh?: string
  countryCode?: string
  lat: number
  lon: number
  kind?: string
  osmKey?: string
  osmValue?: string
}

type PhotonFeature = {
  geometry?: { coordinates?: [number, number] }
  properties?: Record<string, unknown>
}

const cache = new Map<string, PlaceResult[]>()

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined
}

function toResult(feature: PhotonFeature, index: number, locale: Locale): PlaceResult | null {
  const coordinates = feature.geometry?.coordinates
  const properties = feature.properties ?? {}
  if (!coordinates || coordinates.length < 2) return null
  const [lon, lat] = coordinates
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null
  const name = text(properties.name) ?? text(properties.street) ?? text(properties.city)
  if (!name) return null
  const region = text(properties.state) ?? text(properties.county) ?? text(properties.locality)
  const country = text(properties.country)
  return {
    id: `${properties.osm_type ?? 'p'}-${properties.osm_id ?? index}-${index}`,
    name,
    ...(locale === 'zh' ? { nameZh: name } : {}),
    region,
    ...(locale === 'zh' && region ? { regionZh: region } : {}),
    country,
    ...(locale === 'zh' && country ? { countryZh: country } : {}),
    countryCode: text(properties.countrycode),
    lat,
    lon,
    kind: text(properties.type),
    osmKey: text(properties.osm_key),
    osmValue: text(properties.osm_value),
  }
}

export async function searchPlaces(
  query: string,
  locale: Locale,
  signal?: AbortSignal,
  bias?: { lat: number; lon: number } | null,
): Promise<PlaceResult[]> {
  const trimmed = query.trim()
  if (trimmed.length < 2) return []
  const key = `${locale}:${bias ? `${bias.lat.toFixed(1)},${bias.lon.toFixed(1)}` : ''}:${trimmed.toLowerCase()}`
  const cached = cache.get(key)
  if (cached) return cached

  const url = new URL('https://photon.komoot.io/api/')
  url.searchParams.set('q', trimmed)
  url.searchParams.set('limit', '8')
  // Photon supports default, de, en and fr. Chinese names come back fine
  // from the default language, so only ask for English explicitly.
  if (locale === 'en') url.searchParams.set('lang', 'en')
  if (bias) {
    url.searchParams.set('lat', String(bias.lat))
    url.searchParams.set('lon', String(bias.lon))
  }
  const response = await fetch(url, { signal, headers: { Accept: 'application/json' } })
  if (!response.ok) throw new Error(`Search failed (${response.status})`)
  const data = (await response.json()) as { features?: PhotonFeature[] }
  const results = (data.features ?? [])
    .map((feature, index) => toResult(feature, index, locale))
    .filter((result): result is PlaceResult => Boolean(result))
  cache.set(key, results)
  return results
}

export function placeSubtitle(place: PlaceResult): string {
  return [place.region, place.country].filter(Boolean).join(' · ')
}
