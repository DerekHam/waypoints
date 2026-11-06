/**
 * Pure station-selection helpers.
 *
 * A city usually has more than one station, and they serve different
 * directions (Beijing South for Shanghai, Beijing Chaoyang for Harbin,
 * Beijing West for Xi'an). Picking the single nearest station is therefore
 * wrong for many journeys, so the Worker ranks several candidates on each
 * side and routes the most plausible pairs.
 */

export type Station = {
  name: string
  nameEn?: string
  lat: number
  lon: number
}

export type GeoPoint = {
  lat: number
  lon: number
  name?: string
  nameZh?: string
}

export type StationPair = {
  from: Station
  to: Station
  score: number
}

export type PairOptions = {
  /** Departure stations to test. */
  fromCount?: number
  /** Arrival stations to test. */
  toCount?: number
}

/** Ignore stations farther than this from the stop. */
export const STATION_RADIUS_KM = 70

export function haversineKm(a: [number, number], b: [number, number]): number {
  const radius = 6371.0088
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * radius * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Initial bearing from a to b, in degrees clockwise from north. */
export function bearingDegrees(a: [number, number], b: [number, number]): number {
  const toRad = Math.PI / 180
  const lat1 = a[1] * toRad
  const lat2 = b[1] * toRad
  const dLon = (b[0] - a[0]) * toRad
  const y = Math.sin(dLon) * Math.cos(lat2)
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon)
  return (Math.atan2(y, x) * 180) / Math.PI
}

/** Smallest angle between two bearings, 0–180 degrees. */
export function angularDifference(a: number, b: number): number {
  const difference = Math.abs(a - b) % 360
  return difference > 180 ? 360 - difference : difference
}

export function normaliseName(value: string): string {
  return value
    .toLowerCase()
    .replace(/站|车站|火车站|railway|station/g, '')
    .replace(/[\s·・.,'’()（）\-_/]/g, '')
    .replace(/市$/, '')
}

function stationNames(station: Station): string[] {
  return [station.name, station.nameEn]
    .filter((name): name is string => Boolean(name))
    .map(normaliseName)
    .filter(Boolean)
}

/**
 * Merge results from several providers, dropping duplicates that are clearly
 * the same station (same name within a few hundred metres).
 */
export function mergeStations(groups: Station[][]): Station[] {
  const merged: Station[] = []
  for (const group of groups) {
    for (const station of group) {
      if (!station?.name || !Number.isFinite(station.lat) || !Number.isFinite(station.lon)) {
        continue
      }
      const name = normaliseName(station.name)
      const existing = merged.find((item) => {
        const distance = haversineKm([item.lon, item.lat], [station.lon, station.lat])
        // Station, halt and platform nodes for the same place are often a few
        // hundred metres apart; treat them as one station.
        return distance < 0.6 || (name.length > 0 && normaliseName(item.name) === name && distance < 3)
      })
      if (existing) {
        if (!existing.nameEn && station.nameEn) existing.nameEn = station.nameEn
        continue
      }
      merged.push({ ...station })
    }
  }
  return merged
}

/**
 * Arrival stations, best first. This uses the same ranking as departures so
 * that a short name match ("西安") outranks a nearby metro stop
 * ("西安工大·武德路") when a station has to be retried.
 */
export function rankArrivals(candidates: Station[], target: GeoPoint, limit = 3): Station[] {
  return rankStations(candidates, target, Math.max(1, limit))
}

/**
 * Rank the stations that could serve a stop. Distance is the main signal;
 * a name that matches the stop is a bonus, and short names ("北京南") are
 * preferred over long descriptive ones ("北京大学东门", usually metro).
 */
export function rankStations(
  candidates: Station[],
  target: GeoPoint,
  limit = 8,
): Station[] {
  const targetNames = [target.name, target.nameZh]
    .filter((name): name is string => Boolean(name?.trim()))
    .map((name) => normaliseName(name))
    .filter(Boolean)
  const longestTarget = targetNames.reduce((longest, name) => Math.max(longest, name.length), 0)

  const ranked: Array<{ station: Station; score: number }> = []
  for (const station of candidates) {
    const distance = haversineKm([target.lon, target.lat], [station.lon, station.lat])
    if (distance > STATION_RADIUS_KM) continue
    const names = stationNames(station)
    const nameMatch =
      targetNames.length > 0 &&
      names.some((name) => targetNames.some((target) => name.includes(target) || target.includes(name)))
    const extra = longestTarget
      ? Math.min(
          8,
          Math.max(0, ...names.map((name) => Math.max(0, name.length - longestTarget))),
        )
      : 0
    const score = distance - (nameMatch ? 12 : 0) + extra * 1.5
    ranked.push({ station, score })
  }

  ranked.sort((a, b) => a.score - b.score)
  return ranked.slice(0, limit).map((item) => item.station)
}

/**
 * Build the station pairs worth testing for one leg.
 *
 * Departure choice is the important one: a city's stations face different
 * directions, so we take the central station plus the stations best aligned
 * with the destination. The caller then routes each pair on real tracks and
 * keeps the shortest, which is how Beijing South wins for Shanghai and
 * Beijing Chaoyang wins for Harbin.
 *
 * Arrival stations use the same name-aware ranking, so a short local name
 * beats a nearby metro stop. The last few kilometres of a long journey are
 * visually irrelevant, and the central terminus is the most recognisable
 * place to end.
 */
export function rankStationPairs(
  fromCandidates: Station[],
  toCandidates: Station[],
  from: GeoPoint,
  to: GeoPoint,
  options: PairOptions = {},
): StationPair[] {
  const fromCount = Math.max(1, options.fromCount ?? 4)
  const toCount = Math.max(1, options.toCount ?? 1)
  if (!fromCandidates.length || !toCandidates.length) return []

  const direct = haversineKm([from.lon, from.lat], [to.lon, to.lat])
  const directBearing = bearingDegrees([from.lon, from.lat], [to.lon, to.lat])

  const originScore = (station: Station): number => {
    const distance = haversineKm([from.lon, from.lat], [station.lon, station.lat])
    // A station in the city centre serves every direction; give it a pass so
    // the obvious central terminus is always tested.
    if (distance < 4) return distance - 25
    const bearing = bearingDegrees([from.lon, from.lat], [station.lon, station.lat])
    const alignment = angularDifference(bearing, directBearing)
    return alignment + distance * 0.5
  }

  const departures = [...fromCandidates]
    .sort((a, b) => originScore(a) - originScore(b))
    .slice(0, fromCount)

  const arrivals = rankArrivals(toCandidates, to, toCount)

  const pairs: StationPair[] = []
  for (const departure of departures) {
    const connectorFrom = haversineKm([from.lon, from.lat], [departure.lon, departure.lat])
    for (const arrival of arrivals) {
      const connectorTo = haversineKm([to.lon, to.lat], [arrival.lon, arrival.lat])
      const via = haversineKm([departure.lon, departure.lat], [arrival.lon, arrival.lat])
      const detour = Math.max(0, connectorFrom + via + connectorTo - direct)
      pairs.push({
        from: departure,
        to: arrival,
        score: detour + 0.6 * (connectorFrom + connectorTo),
      })
    }
  }
  pairs.sort((a, b) => a.score - b.score)
  return pairs
}
