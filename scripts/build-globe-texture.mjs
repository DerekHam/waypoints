/**
 * Build the antique globe basemap.
 *
 * Data: Natural Earth (public domain) — 1:10m vectors and the 1:50m shaded
 * relief raster. The generated JPEGs are what the site ships; the source data
 * is cached in .globe-cache and ignored by git.
 *
 * Usage: npm run globe:texture
 */
import { execFileSync } from 'node:child_process'
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geoEquirectangular, geoGraticule, geoPath } from 'd3-geo'
import { createCanvas, loadImage } from '@napi-rs/canvas'
import sharp from 'sharp'
import { read as readShapefile } from 'shapefile'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const CACHE = join(ROOT, '.globe-cache')
const GEO_CACHE = join(CACHE, 'geojson')
const SHP_CACHE = join(CACHE, 'shapefiles')
const RELIEF_CACHE = join(CACHE, 'relief')
const OUT = join(ROOT, 'public', 'globe')
const WIDTH = Number(process.argv.find((arg) => arg.startsWith('--size='))?.split('=')[1] ?? 8192)
const HEIGHT = WIDTH / 2
const LOW_WIDTH = Math.min(4096, WIDTH)
const LOW_HEIGHT = LOW_WIDTH / 2

const NE_BASE = 'https://naciscdn.org/naturalearth'
const RELIEF_URL = `${NE_BASE}/50m/raster/NE2_50M_SR_W.zip`
const RELIEF_ZIP = join(CACHE, 'NE2_50M_SR_W.zip')

const SHP_FILES = {
  land: '10m/physical/ne_10m_land.zip',
  countries: '10m/cultural/ne_10m_admin_0_countries.zip',
  states: '10m/cultural/ne_10m_admin_1_states_provinces_lines.zip',
  roads: '10m/cultural/ne_10m_roads.zip',
  railroads: '10m/cultural/ne_10m_railroads.zip',
  rivers: '10m/physical/ne_10m_rivers_lake_centerlines.zip',
  lakes: '10m/physical/ne_10m_lakes.zip',
  places: '10m/cultural/ne_10m_populated_places.zip',
  urban: '50m/cultural/ne_50m_urban_areas.zip',
}

const COLORS = {
  ocean: '#ece2cd',
  land: '#d6c49e',
  coast: '#5e4e3b',
  coastSoft: 'rgba(94, 78, 59, 0.13)',
  country: 'rgba(82, 68, 50, 0.16)',
  state: 'rgba(82, 68, 50, 0.09)',
  lake: '#e5ddca',
  lakeLine: 'rgba(93, 108, 103, 0.42)',
  river: 'rgba(93, 113, 108, 0.36)',
  road: 'rgba(127, 94, 56, 0.22)',
  roadMajor: 'rgba(120, 86, 49, 0.28)',
  rail: 'rgba(70, 59, 47, 0.25)',
  city: 'rgba(70, 55, 35, 0.42)',
  urban: 'rgba(144, 113, 73, 0.055)',
  graticule: 'rgba(95, 79, 58, 0.18)',
  graticuleFine: 'rgba(95, 79, 58, 0.06)',
}

function log(message) {
  console.log(`· ${message}`)
}

function download(url, destination) {
  if (existsSync(destination) && statSync(destination).size > 1024) return
  mkdirSync(dirname(destination), { recursive: true })
  const part = `${destination}.part`
  log(`downloading ${url.split('/').pop()}`)
  execFileSync(
    'curl',
    [
      '-L',
      '--fail',
      '--retry',
      '10',
      '--retry-delay',
      '2',
      '--retry-all-errors',
      '--connect-timeout',
      '30',
      '--max-time',
      '1800',
      '-C',
      '-',
      '--silent',
      '--show-error',
      '-o',
      part,
      url,
    ],
    { stdio: 'inherit' },
  )
  renameSync(part, destination)
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'))
}

function prop(feature, ...names) {
  for (const name of names) {
    const value = feature.properties?.[name]
    if (value !== undefined && value !== null) return value
  }
  return undefined
}

async function loadShapefile(key) {
  const source = SHP_FILES[key]
  if (!source) throw new Error(`Unknown shapefile: ${key}`)
  const jsonPath = join(GEO_CACHE, `${key}.geojson`)
  if (existsSync(jsonPath) && statSync(jsonPath).size > 1024) return readJson(jsonPath)

  const zipPath = join(SHP_CACHE, `${key}.zip`)
  download(`${NE_BASE}/${source}`, zipPath)
  const folder = join(SHP_CACHE, key)
  if (!existsSync(folder) || readdirSync(folder).length === 0) {
    mkdirSync(folder, { recursive: true })
    log(`extracting ${key}`)
    execFileSync('unzip', ['-o', zipPath, '-d', folder], { stdio: 'ignore' })
  }
  const shp = readdirSync(folder).find((file) => file.toLowerCase().endsWith('.shp'))
  const dbf = readdirSync(folder).find((file) => file.toLowerCase().endsWith('.dbf'))
  if (!shp) throw new Error(`No .shp found for ${key}`)
  log(`converting ${key}`)
  const collection = await readShapefile(join(folder, shp), dbf ? join(folder, dbf) : undefined)
  writeFileSync(jsonPath, JSON.stringify(collection))
  return collection
}

function featureCollection(features) {
  return { type: 'FeatureCollection', features }
}

function findFile(directory, pattern) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) {
      const nested = findFile(path, pattern)
      if (nested) return nested
    } else if (pattern.test(entry.name)) {
      return path
    }
  }
  return null
}

function projectionFor(width, height) {
  return geoEquirectangular()
    .translate([width / 2, height / 2])
    .scale(width / (2 * Math.PI))
}

function lineDistance(width) {
  return Math.max(1, width / 4096)
}

async function build() {
  mkdirSync(GEO_CACHE, { recursive: true })
  mkdirSync(SHP_CACHE, { recursive: true })
  mkdirSync(OUT, { recursive: true })

  download(RELIEF_URL, RELIEF_ZIP)
  if (!existsSync(RELIEF_CACHE) || readdirSync(RELIEF_CACHE).length === 0) {
    mkdirSync(RELIEF_CACHE, { recursive: true })
    log('extracting shaded relief')
    execFileSync('unzip', ['-o', RELIEF_ZIP, '-d', RELIEF_CACHE], { stdio: 'ignore' })
  }

  log(`reading vectors for ${WIDTH}×${HEIGHT}`)
  const land = await loadShapefile('land')
  const countries = await loadShapefile('countries')
  const states = await loadShapefile('states')
  const roads = await loadShapefile('roads')
  const railroads = await loadShapefile('railroads')
  const rivers = await loadShapefile('rivers')
  const lakes = await loadShapefile('lakes')
  const places = await loadShapefile('places')
  const urban = await loadShapefile('urban')

  const allowedRoadTypes = new Set([
    'Major Highway',
    'Secondary Highway',
    'Beltway',
    'Bypass',
    'Road',
  ])
  const roadFeatures = roads.features.filter((feature) =>
    allowedRoadTypes.has(prop(feature, 'type', 'TYPE')),
  )
  const railFeatures = railroads.features.filter(
    (feature) => (prop(feature, 'scalerank', 'SCALERANK') ?? 99) <= 7,
  )
  const riverFeatures = rivers.features.filter(
    (feature) => (prop(feature, 'scalerank', 'SCALERANK') ?? 99) <= 9,
  )
  const cityFeatures = places.features.filter(
    (feature) =>
      (prop(feature, 'pop_max', 'POP_MAX') ?? 0) >= 1_000_000 ||
      (prop(feature, 'scalerank', 'SCALERANK') ?? 99) <= 3,
  )
  const urbanFeatures = urban.features.filter(
    (feature) => (prop(feature, 'scalerank', 'SCALERANK') ?? 99) <= 4,
  )

  log(
    `features: ${roadFeatures.length} roads, ${railFeatures.length} rail, ${riverFeatures.length} rivers, ${cityFeatures.length} cities`,
  )

  const reliefFile = findFile(RELIEF_CACHE, /\.tiff?$/i)
  if (!reliefFile) throw new Error('No TIFF found in the shaded relief archive')
  log('preparing shaded relief')
  const reliefBuffer = await sharp(reliefFile)
    .resize(WIDTH, HEIGHT, { fit: 'fill' })
    .grayscale()
    .linear(1.04, -5)
    .jpeg({ quality: 90 })
    .toBuffer()
  const reliefImage = await loadImage(reliefBuffer)

  const canvas = createCanvas(WIDTH, HEIGHT)
  const context = canvas.getContext('2d')
  const projection = projectionFor(WIDTH, HEIGHT)
  const path = geoPath(projection, context)
  const unit = lineDistance(WIDTH)

  log('painting ocean, land and relief')
  context.fillStyle = COLORS.ocean
  context.fillRect(0, 0, WIDTH, HEIGHT)

  context.beginPath()
  path(land)
  context.fillStyle = COLORS.land
  context.fill()
  context.lineJoin = 'round'
  context.lineCap = 'round'

  context.save()
  context.beginPath()
  path(land)
  context.clip()
  context.globalAlpha = 0.38
  context.globalCompositeOperation = 'multiply'
  context.drawImage(reliefImage, 0, 0, WIDTH, HEIGHT)
  context.restore()

  context.fillStyle = COLORS.urban
  context.beginPath()
  path(featureCollection(urbanFeatures))
  context.fill()

  log('painting lakes and rivers')
  context.beginPath()
  path(lakes)
  context.fillStyle = COLORS.lake
  context.fill()
  context.strokeStyle = COLORS.lakeLine
  context.lineWidth = 1.1 * unit
  context.stroke()

  context.beginPath()
  path(featureCollection(riverFeatures))
  context.strokeStyle = COLORS.river
  context.lineWidth = 1.15 * unit
  context.stroke()

  log('painting coastlines and borders')
  context.strokeStyle = COLORS.coastSoft
  context.lineWidth = 5.5 * unit
  context.beginPath()
  path(land)
  context.stroke()

  context.strokeStyle = COLORS.coast
  context.lineWidth = 1.6 * unit
  context.beginPath()
  path(land)
  context.stroke()

  context.strokeStyle = COLORS.country
  context.lineWidth = 0.95 * unit
  context.beginPath()
  path(countries)
  context.stroke()

  context.strokeStyle = COLORS.state
  context.lineWidth = 0.9 * unit
  context.beginPath()
  path(states)
  context.stroke()

  log('painting roads and railways')
  context.strokeStyle = COLORS.road
  context.lineWidth = 1.1 * unit
  context.beginPath()
  path(
    featureCollection(
      roadFeatures.filter((feature) => prop(feature, 'type', 'TYPE') !== 'Major Highway'),
    ),
  )
  context.stroke()

  context.strokeStyle = COLORS.roadMajor
  context.lineWidth = 1.5 * unit
  context.beginPath()
  path(
    featureCollection(
      roadFeatures.filter((feature) => prop(feature, 'type', 'TYPE') === 'Major Highway'),
    ),
  )
  context.stroke()

  context.strokeStyle = COLORS.rail
  context.lineWidth = 1.0 * unit
  context.setLineDash([4 * unit, 3 * unit])
  context.beginPath()
  path(featureCollection(railFeatures))
  context.stroke()
  context.setLineDash([])

  log('painting cities')
  for (const place of cityFeatures) {
    const coordinates = place.geometry?.coordinates
    if (!coordinates) continue
    const point = projection([coordinates[0], coordinates[1]])
    if (!point) continue
    const population = prop(place, 'pop_max', 'POP_MAX') ?? 0
    const radius = (2 + Math.min(2.5, Math.log10(Math.max(1_000_000, population)) - 5)) * unit
    context.beginPath()
    context.arc(point[0], point[1], radius, 0, Math.PI * 2)
    context.fillStyle = COLORS.city
    context.fill()
  }

  log('painting graticule')
  context.strokeStyle = COLORS.graticuleFine
  context.lineWidth = 1.0 * unit
  context.beginPath()
  path(geoGraticule().step([10, 10])())
  context.stroke()

  context.strokeStyle = COLORS.graticule
  context.lineWidth = 1.5 * unit
  context.beginPath()
  path(geoGraticule().step([30, 30])())
  context.stroke()

  log('paper grain and stains')
  const grain = createCanvas(512, 512)
  const grainContext = grain.getContext('2d')
  const pixels = grainContext.createImageData(512, 512)
  for (let index = 0; index < pixels.data.length; index += 4) {
    const value = 90 + Math.random() * 90
    pixels.data[index] = value
    pixels.data[index + 1] = value * 0.9
    pixels.data[index + 2] = value * 0.72
    pixels.data[index + 3] = Math.random() * 25
  }
  grainContext.putImageData(pixels, 0, 0)
  const pattern = context.createPattern(grain, 'repeat')
  if (pattern) {
    context.save()
    context.globalCompositeOperation = 'multiply'
    context.globalAlpha = 0.09
    context.fillStyle = pattern
    context.fillRect(0, 0, WIDTH, HEIGHT)
    context.restore()
  }

  const stains = [
    [0.18, 0.33, 0.16, 0.045],
    [0.72, 0.22, 0.22, 0.03],
    [0.46, 0.78, 0.2, 0.028],
    [0.9, 0.62, 0.12, 0.04],
  ]
  for (const [x, y, radius, alpha] of stains) {
    const gradient = context.createRadialGradient(
      WIDTH * x,
      HEIGHT * y,
      0,
      WIDTH * x,
      HEIGHT * y,
      WIDTH * radius,
    )
    gradient.addColorStop(0, `rgba(126, 92, 52, ${alpha})`)
    gradient.addColorStop(1, 'rgba(126, 92, 52, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, WIDTH, HEIGHT)
  }

  log('encoding high-resolution JPEG')
  const highJpeg = await canvas.encode('jpeg', 88)
  const highPath = join(OUT, `globe-${WIDTH}.jpg`)
  writeFileSync(highPath, highJpeg)
  console.log(`  ${highPath} (${(highJpeg.length / 1024 / 1024).toFixed(2)} MB)`)

  if (LOW_WIDTH !== WIDTH) {
    log(`downscaling to ${LOW_WIDTH}×${LOW_HEIGHT}`)
    const lowJpeg = await sharp(highJpeg)
      .resize(LOW_WIDTH, LOW_HEIGHT, { kernel: 'lanczos3' })
      .jpeg({ quality: 86, mozjpeg: true })
      .toBuffer()
    const lowPath = join(OUT, `globe-${LOW_WIDTH}.jpg`)
    writeFileSync(lowPath, lowJpeg)
    console.log(`  ${lowPath} (${(lowJpeg.length / 1024 / 1024).toFixed(2)} MB)`)
  }
}

await build()
