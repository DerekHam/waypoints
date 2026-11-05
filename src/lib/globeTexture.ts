import { geoEquirectangular, geoGraticule, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'

const OCEAN = '#ede3cf'
const LAND = '#d3c19b'
const COAST = '#65543e'
const COAST_SOFT = 'rgba(101, 84, 62, 0.16)'
const BORDER = 'rgba(95, 78, 56, 0.2)'
const GRATICULE = 'rgba(95, 79, 58, 0.24)'

type TopologyLike = {
  objects: Record<string, unknown>
}

export type TextureProgress = {
  stage: 'loading' | 'drawing' | 'ready' | 'error'
  message?: string
}

export async function createGlobeTexture(
  onProgress?: (progress: TextureProgress) => void,
): Promise<HTMLCanvasElement> {
  onProgress?.({ stage: 'loading' })
  const compact = window.innerWidth < 820
  const width = compact ? 2048 : 4096
  const height = width / 2
  const base = import.meta.env.BASE_URL || './'
  const file = compact ? 'countries-110m.json' : 'countries-50m.json'
  const url = new URL(`${base.replace(/\/$/, '')}/geo/${file}`, document.baseURI)
  const response = await fetch(url)
  if (!response.ok) throw new Error(`Geography failed to load (${response.status})`)
  const topology = (await response.json()) as TopologyLike
  const object = Object.values(topology.objects)[0]
  const countries = feature(topology as never, object as never)

  onProgress?.({ stage: 'drawing' })
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('Canvas is unavailable')

  context.fillStyle = OCEAN
  context.fillRect(0, 0, width, height)

  const projection = geoEquirectangular()
    .translate([width / 2, height / 2])
    .scale(width / (2 * Math.PI))
  const path = geoPath(projection, context)

  context.beginPath()
  path(countries as never)
  context.fillStyle = LAND
  context.fill()
  context.lineJoin = 'round'

  // Faint national borders, engraved rather than modern.
  const countryFeatures = (countries as { features?: unknown[] }).features
  if (countryFeatures) {
    context.strokeStyle = BORDER
    context.lineWidth = Math.max(0.8, width / 4096)
    for (const country of countryFeatures) {
      context.beginPath()
      path(country as never)
      context.stroke()
    }
  }

  // A soft, wide coastline wash gives the map its engraved edge.
  context.strokeStyle = COAST_SOFT
  context.lineWidth = Math.max(3, width / 512)
  context.stroke()

  context.strokeStyle = COAST
  context.lineWidth = Math.max(1.6, width / 2048)
  context.stroke()

  context.beginPath()
  path(geoGraticule().step([30, 30])() as never)
  context.strokeStyle = GRATICULE
  context.lineWidth = Math.max(1, width / 3072)
  context.stroke()

  // Subtle warm shading at the poles, like aged paper.
  const poleWash = context.createLinearGradient(0, 0, 0, height)
  poleWash.addColorStop(0, 'rgba(122, 96, 62, 0.075)')
  poleWash.addColorStop(0.14, 'rgba(122, 96, 62, 0)')
  poleWash.addColorStop(0.86, 'rgba(122, 96, 62, 0)')
  poleWash.addColorStop(1, 'rgba(122, 96, 62, 0.09)')
  context.fillStyle = poleWash
  context.fillRect(0, 0, width, height)

  // Paper grain.
  const noise = document.createElement('canvas')
  noise.width = 256
  noise.height = 256
  const noiseContext = noise.getContext('2d')
  if (noiseContext) {
    const pixels = noiseContext.createImageData(noise.width, noise.height)
    for (let i = 0; i < pixels.data.length; i += 4) {
      const value = 90 + Math.random() * 90
      pixels.data[i] = value
      pixels.data[i + 1] = value * 0.9
      pixels.data[i + 2] = value * 0.72
      pixels.data[i + 3] = Math.random() * 26
    }
    noiseContext.putImageData(pixels, 0, 0)
    const pattern = context.createPattern(noise, 'repeat')
    if (pattern) {
      context.save()
      context.globalCompositeOperation = 'multiply'
      context.globalAlpha = 0.11
      context.fillStyle = pattern
      context.fillRect(0, 0, width, height)
      context.restore()
    }
  }

  // A few faint tea-coloured stains.
  const stains = [
    [0.18, 0.33, 0.16, 0.05],
    [0.72, 0.22, 0.22, 0.035],
    [0.46, 0.78, 0.2, 0.03],
    [0.9, 0.62, 0.12, 0.045],
  ]
  for (const [x, y, radius, alpha] of stains) {
    const gradient = context.createRadialGradient(
      width * x,
      height * y,
      0,
      width * x,
      height * y,
      width * radius,
    )
    gradient.addColorStop(0, `rgba(126, 92, 52, ${alpha})`)
    gradient.addColorStop(1, 'rgba(126, 92, 52, 0)')
    context.fillStyle = gradient
    context.fillRect(0, 0, width, height)
  }

  onProgress?.({ stage: 'ready' })
  return canvas
}
