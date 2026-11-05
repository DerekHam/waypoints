/**
 * Populate route geometry for the sample atlas.
 *
 * Rail geometry: OpenRailRouting (OSM railway tracks).
 * Road geometry: OSRM (FOSSGIS demo).
 * Flights and ferries are computed client-side; this script only stores
 * distance/provider metadata for them.
 *
 * Usage: npm run routes
 */
import { readFile, writeFile } from 'node:fs/promises'

const ATLAS_PATH = new URL('../public/data/atlas.json', import.meta.url)
const USER_AGENT = 'WaypointsAtlas/1.0 (+https://waypoints.derekhan.link)'
const ORT_ENDPOINT = 'https://routing.openrailrouting.org/route'
const OSRM_ENDPOINT = 'https://router.project-osrm.org/route/v1'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

// Mainline stations chosen for the sample. City-centre coordinates often snap
// to a disconnected siding in OSM; routing from the principal station is much
// more reliable. The stop-to-station connector is added to the drawn line.
const STATIONS = {
  shanghai: { name: '上海站', lat: 31.2515568, lon: 121.4511645 },
  suzhou: { name: '苏州站', lat: 31.3318827, lon: 120.6066762 },
  hangzhou: { name: '杭州站', lat: 30.2459675, lon: 120.1783532 },
  huangshan: { name: '黄山北站', lat: 29.8183365, lon: 118.2673395 },
  wuhan: { name: '武汉站', lat: 30.6098504, lon: 114.4189431 },
  chongqing: { name: '重庆北站', lat: 29.6123216, lon: 106.5472729 },
  chengdu: { name: '成都东站', lat: 30.629, lon: 104.141 },
  xian: { name: "西安北站", lat: 34.376, lon: 108.94 },
}

function haversineKm(a, b) {
  const R = 6371.0088
  const dLat = ((b[1] - a[1]) * Math.PI) / 180
  const dLon = ((b[0] - a[0]) * Math.PI) / 180
  const lat1 = (a[1] * Math.PI) / 180
  const lat2 = (b[1] * Math.PI) / 180
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)))
}

function toVector([lon, lat]) {
  const phi = ((90 - lat) * Math.PI) / 180
  const theta = ((lon + 180) * Math.PI) / 180
  return [
    -Math.sin(phi) * Math.cos(theta),
    Math.cos(phi),
    Math.sin(phi) * Math.sin(theta),
  ]
}

function segmentDistance(point, a, b) {
  const p = toVector(point)
  const av = toVector(a)
  const bv = toVector(b)
  const ab = [bv[0] - av[0], bv[1] - av[1], bv[2] - av[2]]
  const ap = [p[0] - av[0], p[1] - av[1], p[2] - av[2]]
  const denom = ab[0] ** 2 + ab[1] ** 2 + ab[2] ** 2
  const t = denom === 0 ? 0 : Math.max(0, Math.min(1, (ap[0] * ab[0] + ap[1] * ab[1] + ap[2] * ab[2]) / denom))
  const closest = [av[0] + ab[0] * t, av[1] + ab[1] * t, av[2] + ab[2] * t]
  return Math.hypot(p[0] - closest[0], p[1] - closest[1], p[2] - closest[2])
}

function simplify(points, tolerance = 0.00025, maxPoints = 500) {
  if (points.length <= 2) return points
  const keep = new Uint8Array(points.length)
  keep[0] = 1
  keep[points.length - 1] = 1
  const stack = [[0, points.length - 1]]
  while (stack.length) {
    const [start, end] = stack.pop()
    let maxDistance = 0
    let index = -1
    for (let i = start + 1; i < end; i += 1) {
      const distance = segmentDistance(points[i], points[start], points[end])
      if (distance > maxDistance) {
        maxDistance = distance
        index = i
      }
    }
    if (maxDistance > tolerance && index !== -1) {
      keep[index] = 1
      stack.push([start, index], [index, end])
    }
  }
  let result = points.filter((_, i) => keep[i])
  if (result.length > maxPoints) {
    const step = (result.length - 1) / (maxPoints - 1)
    result = Array.from({ length: maxPoints }, (_, i) => result[Math.round(i * step)])
  }
  return result.map(([lon, lat]) => [
    Math.round(lon * 10000) / 10000,
    Math.round(lat * 10000) / 10000,
  ])
}

function decodePolyline(encoded, factor = 1e5) {
  const points = []
  let index = 0
  let lat = 0
  let lon = 0
  while (index < encoded.length) {
    let result = 0
    let shift = 0
    let byte
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lat += result & 1 ? ~(result >> 1) : result >> 1
    result = 0
    shift = 0
    do {
      byte = encoded.charCodeAt(index++) - 63
      result |= (byte & 0x1f) << shift
      shift += 5
    } while (byte >= 0x20)
    lon += result & 1 ? ~(result >> 1) : result >> 1
    points.push([lon / factor, lat / factor])
  }
  return points
}

async function getJson(url, attempt = 1) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': USER_AGENT,
        Referer: 'https://waypoints.derekhan.link/',
        Accept: 'application/json',
      },
    })
    if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`)
    return await response.json()
  } catch (error) {
    if (attempt < 4) {
      console.warn(`  retry ${attempt}: ${error.message}`)
      await sleep(2500 * attempt)
      return getJson(url, attempt + 1)
    }
    throw error
  }
}

async function routeTrain(from, to) {
  const fromStation = STATIONS[from.id] ?? { lat: from.lat, lon: from.lon }
  const toStation = STATIONS[to.id] ?? { lat: to.lat, lon: to.lon }
  const url = `${ORT_ENDPOINT}?point=${fromStation.lat},${fromStation.lon}&point=${toStation.lat},${toStation.lon}&profile=all_tracks&points_encoded=true&type=json&locale=en&calc_points=true&instructions=false`
  const data = await getJson(url)
  const path = data.paths?.[0]
  if (!path?.points) throw new Error('No rail path returned')
  // decodePolyline normalises GraphHopper's encoded polyline to [lon, lat].
  const decoded = decodePolyline(path.points, path.points_encoded_multiplier ?? 1e5)
  const track = simplify(decoded)
  const points = [
    [from.lon, from.lat],
    ...track,
    [to.lon, to.lat],
  ]
  const connectorKm =
    haversineKm([from.lon, from.lat], [fromStation.lon, fromStation.lat]) +
    haversineKm([to.lon, to.lat], [toStation.lon, toStation.lat])
  return {
    provider: 'openrailrouting',
    points: simplify(points),
    distanceKm: Math.round((path.distance / 1000 + connectorKm) * 10) / 10,
    status: 'routed',
  }
}

async function routeRoad(mode, from, to) {
  const profile = mode === 'bike' ? 'bike' : mode === 'walk' ? 'foot' : 'driving'
  const url = `${OSRM_ENDPOINT}/${profile}/${from.lon},${from.lat};${to.lon},${to.lat}?overview=full&geometries=geojson&steps=false`
  const data = await getJson(url)
  const route = data.routes?.[0]
  if (!route?.geometry?.coordinates) throw new Error('No road path returned')
  return {
    provider: 'osrm',
    points: simplify(route.geometry.coordinates),
    distanceKm: Math.round((route.distance / 1000) * 10) / 10,
    status: 'routed',
  }
}

const atlas = JSON.parse(await readFile(ATLAS_PATH, 'utf8'))

for (const journey of atlas.journeys) {
  for (let i = 0; i < journey.legs.length; i += 1) {
    const leg = journey.legs[i]
    const from = journey.stops[i]
    const to = journey.stops[i + 1]
    const a = [from.lon, from.lat]
    const b = [to.lon, to.lat]
    const directKm = Math.round(haversineKm(a, b) * 10) / 10
    const label = `${from.name} → ${to.name} (${leg.mode})`
    if (leg.mode === 'plane') {
      leg.route = { provider: 'great-circle', distanceKm: directKm, status: 'routed' }
      leg.connection = null
      console.log(`· ${label}: great-circle ${directKm} km`)
      continue
    }
    if (leg.mode === 'ferry') {
      leg.route = { provider: 'schematic', distanceKm: directKm, status: 'estimated' }
      leg.connection = null
      console.log(`· ${label}: schematic ${directKm} km`)
      continue
    }
    try {
      console.log(`… ${label}`)
      const route = leg.mode === 'train' ? await routeTrain(from, to) : await routeRoad(leg.mode, from, to)
      leg.route = route
      leg.connection = null
      console.log(`✓ ${label}: ${route.distanceKm} km, ${route.points.length} points`)
    } catch (error) {
      console.warn(`✗ ${label}: ${error.message}`)
      leg.route = null
    }
    await sleep(1200)
  }
}

atlas.updatedAt = new Date().toISOString()
await writeFile(ATLAS_PATH, `${JSON.stringify(atlas, null, 2)}\n`)
console.log('Wrote', ATLAS_PATH.pathname)
