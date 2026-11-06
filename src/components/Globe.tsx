import { useEffect, useMemo, useRef, useState } from 'react'
import {
  AttributionControl,
  Map as MapLibreMap,
  NavigationControl,
  setWorkerUrl,
  type GeoJSONSource,
} from 'maplibre-gl'
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import 'maplibre-gl/dist/maplibre-gl.css'
import type { FeatureCollection, LineString, Point } from 'geojson'
import {
  stopName,
  type Atlas,
  type Leg,
  type Locale,
  type Stop,
  type TransportMode,
} from '@shared/atlas'
import { useAtlasStore, useUIStore } from '@/store'
import { useT } from '@/i18n'
import { journeyColor } from '@/lib/colors'

setWorkerUrl(workerUrl)

type StopProperties = {
  stopId: string
  journeyId: string
  index: number
  label: string
  color: string
  active: boolean
  selected: boolean
}

type RouteProperties = {
  journeyId: string
  color: string
  active: boolean
  mode: TransportMode
  estimated: boolean
}

const EMPTY_STOPS: FeatureCollection<Point, StopProperties> = {
  type: 'FeatureCollection',
  features: [],
}
const EMPTY_ROUTES: FeatureCollection<LineString, RouteProperties> = {
  type: 'FeatureCollection',
  features: [],
}

function greatCircle(
  from: [number, number],
  to: [number, number],
  steps = 64,
): [number, number][] {
  const rad = Math.PI / 180
  const deg = 180 / Math.PI
  const [lon1, lat1] = from
  const [lon2, lat2] = to
  const phi1 = lat1 * rad
  const phi2 = lat2 * rad
  const lambda1 = lon1 * rad
  const lambda2 = lon2 * rad
  const x1 = Math.cos(phi1) * Math.cos(lambda1)
  const y1 = Math.cos(phi1) * Math.sin(lambda1)
  const z1 = Math.sin(phi1)
  const x2 = Math.cos(phi2) * Math.cos(lambda2)
  const y2 = Math.cos(phi2) * Math.sin(lambda2)
  const z2 = Math.sin(phi2)
  const dot = Math.max(-1, Math.min(1, x1 * x2 + y1 * y2 + z1 * z2))
  const angle = Math.acos(dot)
  if (angle < 1e-6) return [from, to]
  const sin = Math.sin(angle)
  const points: [number, number][] = []
  for (let index = 0; index <= steps; index += 1) {
    const t = index / steps
    const a = Math.sin((1 - t) * angle) / sin
    const b = Math.sin(t * angle) / sin
    const x = x1 * a + x2 * b
    const y = y1 * a + y2 * b
    const z = z1 * a + z2 * b
    const lat = Math.atan2(z, Math.hypot(x, y)) * deg
    const lon = Math.atan2(y, x) * deg
    points.push([lon, lat])
  }
  return points
}

function routeCoordinates(leg: Leg, from: Stop, to: Stop): [number, number][] {
  if (leg.route?.points?.length) return leg.route.points
  return greatCircle([from.lon, from.lat], [to.lon, to.lat], leg.mode === 'plane' ? 96 : 64)
}

function buildMapData(
  atlas: Atlas | null,
  activeJourneyId: string | null,
  showAll: boolean,
  selectedStopId: string | null,
  locale: Locale,
): {
  stops: FeatureCollection<Point, StopProperties>
  routes: FeatureCollection<LineString, RouteProperties>
} {
  if (!atlas) return { stops: EMPTY_STOPS, routes: EMPTY_ROUTES }
  const activeId = activeJourneyId ?? atlas.journeys[0]?.id ?? null
  const journeys = showAll
    ? atlas.journeys
    : atlas.journeys.filter((journey) => journey.id === activeId)
  const stops: FeatureCollection<Point, StopProperties> = {
    type: 'FeatureCollection',
    features: [],
  }
  const routes: FeatureCollection<LineString, RouteProperties> = {
    type: 'FeatureCollection',
    features: [],
  }

  for (const journey of journeys) {
    const active = journey.id === activeId
    const color = journeyColor(journey.color)
    journey.stops.forEach((stop, index) => {
      stops.features.push({
        type: 'Feature',
        properties: {
          stopId: stop.id,
          journeyId: journey.id,
          index: index + 1,
          label: stopName(stop, locale),
          color,
          active,
          selected: active && selectedStopId === stop.id,
        },
        geometry: {
          type: 'Point',
          coordinates: [stop.lon, stop.lat],
        },
      })
    })

    journey.legs.forEach((leg, index) => {
      const from = journey.stops[index]
      const to = journey.stops[index + 1]
      if (!from || !to) return
      const coordinates = routeCoordinates(leg, from, to)
      if (coordinates.length < 2) return
      routes.features.push({
        type: 'Feature',
        properties: {
          journeyId: journey.id,
          color,
          active,
          mode: leg.mode,
          estimated: !leg.route || leg.route.status !== 'routed',
        },
        geometry: {
          type: 'LineString',
          coordinates,
        },
      })
    })
  }

  return { stops, routes }
}

function addMapLayers(map: MapLibreMap): void {
  if (map.getSource('waypoints-routes')) return

  map.addSource('waypoints-routes', { type: 'geojson', data: EMPTY_ROUTES })
  map.addSource('waypoints-stops', { type: 'geojson', data: EMPTY_STOPS })

  const layers = map.getStyle().layers ?? []
  const firstSymbol = layers.find((layer) => layer.type === 'symbol')?.id

  map.addLayer(
    {
      id: 'waypoints-route-halo',
      type: 'line',
      source: 'waypoints-routes',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': '#f5ecd9',
        'line-width': 5.5,
        'line-opacity': ['case', ['get', 'active'], 0.62, 0.1],
      },
    },
    firstSymbol,
  )

  map.addLayer(
    {
      id: 'waypoints-route-train',
      type: 'line',
      source: 'waypoints-routes',
      filter: [
        'all',
        ['==', ['get', 'mode'], 'train'],
        ['!=', ['get', 'estimated'], true],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.8, 6, 2.5, 12, 3.6],
        'line-opacity': ['case', ['get', 'active'], 0.95, 0.2],
      },
    },
    firstSymbol,
  )

  map.addLayer(
    {
      id: 'waypoints-route-dashed',
      type: 'line',
      source: 'waypoints-routes',
      filter: [
        'any',
        ['!=', ['get', 'mode'], 'train'],
        ['==', ['get', 'estimated'], true],
      ],
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: {
        'line-color': ['get', 'color'],
        'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.6, 6, 2.2, 12, 3.2],
        'line-dasharray': [2, 2],
        'line-opacity': ['case', ['get', 'active'], 0.9, 0.2],
      },
    },
    firstSymbol,
  )

  // Stops sit above the base map labels so the itinerary remains readable.
  map.addLayer({
    id: 'waypoints-stop-halo',
    type: 'circle',
    source: 'waypoints-stops',
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 13, ['get', 'active'], 10, 6],
      'circle-color': '#faf4e7',
      'circle-opacity': ['case', ['get', 'active'], 0.9, 0.6],
      'circle-blur': 0.2,
    },
  })

  map.addLayer({
    id: 'waypoints-stop-circle',
    type: 'circle',
    source: 'waypoints-stops',
    paint: {
      'circle-radius': ['case', ['get', 'selected'], 9, ['get', 'active'], 7, 4],
      'circle-color': ['get', 'color'],
      'circle-stroke-color': '#faf4e7',
      'circle-stroke-width': 1.5,
      'circle-opacity': ['case', ['get', 'active'], 1, 0.5],
    },
  })

  map.addLayer({
    id: 'waypoints-stop-number',
    type: 'symbol',
    source: 'waypoints-stops',
    filter: ['==', ['get', 'active'], true],
    layout: {
      'text-field': ['to-string', ['get', 'index']],
      'text-font': ['Noto Sans Bold'],
      'text-size': 9,
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#fbf4e4',
    },
  })

  map.addLayer({
    id: 'waypoints-stop-label',
    type: 'symbol',
    source: 'waypoints-stops',
    filter: ['==', ['get', 'active'], true],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 11,
      'text-offset': [1, 0],
      'text-anchor': 'left',
      'text-max-width': 10,
      'text-optional': true,
      'symbol-sort-key': ['get', 'index'],
    },
    paint: {
      'text-color': '#3b3327',
      'text-halo-color': '#f3ead9',
      'text-halo-width': 1.5,
    },
  })

  map.addLayer({
    id: 'waypoints-stop-selected-label',
    type: 'symbol',
    source: 'waypoints-stops',
    filter: ['==', ['get', 'selected'], true],
    layout: {
      'text-field': ['get', 'label'],
      'text-font': ['Noto Sans Regular'],
      'text-size': 12,
      'text-offset': [1, 0],
      'text-anchor': 'left',
      'text-allow-overlap': true,
      'text-ignore-placement': true,
    },
    paint: {
      'text-color': '#3b3327',
      'text-halo-color': '#f3ead9',
      'text-halo-width': 1.6,
    },
  })

  const stopLayers = [
    'waypoints-stop-circle',
    'waypoints-stop-number',
    'waypoints-stop-label',
    'waypoints-stop-selected-label',
  ]
  for (const layer of stopLayers) {
    map.on('click', layer, (event) => {
      const properties = event.features?.[0]?.properties as StopProperties | undefined
      if (properties) {
        useUIStore.getState().selectStop(properties.journeyId, properties.stopId)
      }
    })
    map.on('mouseenter', layer, () => {
      map.getCanvas().style.cursor = 'pointer'
    })
    map.on('mouseleave', layer, () => {
      map.getCanvas().style.cursor = ''
    })
  }
}

export function Globe(): React.ReactElement {
  const { t } = useT()
  const atlas = useAtlasStore((state) => state.atlas)
  const selectedJourneyId = useUIStore((state) => state.selectedJourneyId)
  const selectedStopId = useUIStore((state) => state.selectedStopId)
  const showAll = useUIStore((state) => state.showAll)
  const locale = useUIStore((state) => state.locale)
  const [ready, setReady] = useState(false)
  const [error, setError] = useState(false)
  const stageRef = useRef<HTMLDivElement>(null)
  const mapContainerRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<MapLibreMap | null>(null)
  const atlasRef = useRef<Atlas | null>(atlas)
  atlasRef.current = atlas

  const mapData = useMemo(
    () =>
      buildMapData(
        atlas,
        selectedJourneyId,
        showAll,
        selectedStopId,
        locale,
      ),
    [atlas, selectedJourneyId, showAll, selectedStopId, locale],
  )

  useEffect(() => {
    const container = mapContainerRef.current
    const stage = stageRef.current
    if (!container || !stage) return
    const base = import.meta.env.BASE_URL || './'
    const styleUrl = new URL(
      `${base.replace(/\/$/, '')}/map-style.json`,
      document.baseURI,
    ).toString()

    let map: MapLibreMap
    try {
      map = new MapLibreMap({
        container,
        style: styleUrl,
        center: [108, 30],
        zoom: 2.8,
        minZoom: 0.7,
        maxZoom: 18,
        maxPitch: 80,
        attributionControl: false,
        canvasContextAttributes: { antialias: true },
      })
    } catch {
      setError(true)
      return
    }
    mapRef.current = map

    map.addControl(new AttributionControl({ compact: true }), 'bottom-right')
    map.addControl(
      new NavigationControl({ visualizePitch: true, showZoom: true, showCompass: true }),
      'bottom-right',
    )

    map.on('style.load', () => {
      map.setProjection({ type: 'globe' })
      addMapLayers(map)
    })
    map.once('load', () => setReady(true))
    map.on('error', (event) => {
      if (!map.isStyleLoaded()) {
        console.error('Map failed to load', event.error)
        setError(true)
      }
    })

    const resizeObserver = new ResizeObserver(() => map.resize())
    resizeObserver.observe(stage)
    const frame = window.requestAnimationFrame(() => map.resize())

    return () => {
      window.cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      map.remove()
      mapRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    if (!map) return
    const stops = map.getSource('waypoints-stops') as GeoJSONSource | undefined
    const routes = map.getSource('waypoints-routes') as GeoJSONSource | undefined
    stops?.setData(mapData.stops)
    routes?.setData(mapData.routes)
  }, [mapData, ready])

  useEffect(() => {
    if (!ready) return
    const map = mapRef.current
    const currentAtlas = atlasRef.current
    if (!map || !currentAtlas) return
    const journey =
      currentAtlas.journeys.find((item) => item.id === selectedJourneyId) ??
      currentAtlas.journeys[0]
    if (!journey) return

    if (selectedStopId) {
      const stop = journey.stops.find((item) => item.id === selectedStopId)
      if (stop) {
        map.flyTo({
          center: [stop.lon, stop.lat],
          zoom: Math.max(map.getZoom(), 6),
          duration: 1100,
          essential: true,
        })
        return
      }
    }

    if (journey.stops.length === 0) return
    let minLon = Number.POSITIVE_INFINITY
    let minLat = Number.POSITIVE_INFINITY
    let maxLon = Number.NEGATIVE_INFINITY
    let maxLat = Number.NEGATIVE_INFINITY
    for (const stop of journey.stops) {
      minLon = Math.min(minLon, stop.lon)
      maxLon = Math.max(maxLon, stop.lon)
      minLat = Math.min(minLat, stop.lat)
      maxLat = Math.max(maxLat, stop.lat)
    }
    map.fitBounds(
      [
        [minLon, minLat],
        [maxLon, maxLat],
      ],
      { padding: 70, maxZoom: 3.6, duration: 1100 },
    )
  }, [ready, selectedJourneyId, selectedStopId])

  return (
    <div className={`globe-stage ${ready ? 'is-ready' : ''}`} ref={stageRef}>
      <div className="map-canvas" ref={mapContainerRef} />
      {!ready && !error ? (
        <div className="globe-loading" aria-live="polite">
          <div className="globe-loading-orb" aria-hidden="true" />
          <p>{t('loading')}</p>
        </div>
      ) : null}
      {error ? (
        <div className="globe-loading" role="alert">
          <p>{t('errorBody')}</p>
        </div>
      ) : null}
    </div>
  )
}
