import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react'
import * as THREE from 'three'
import { TrackballControls } from 'three/examples/jsm/controls/TrackballControls.js'
import { Line2 } from 'three/examples/jsm/lines/Line2.js'
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js'
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js'
import { stopName, type Atlas, type Journey, type Leg, type Stop } from '@shared/atlas'
import { useAtlasStore, useUIStore } from '@/store'
import { useT } from '@/i18n'
import { journeyColor } from '@/lib/colors'
import { loadGlobeTexture } from '@/lib/globeTexture'
import { clamp, latLonToVector3 } from '@/lib/geo'

const HALO = new THREE.Color('#efe5d1')

type TextureState = 'loading' | 'drawing' | 'ready' | 'error'

type PinData = {
  key: string
  journeyId: string
  stopId: string
  lat: number
  lon: number
  label: string
  index: number
  active: boolean
  selected: boolean
  color: string
  labelWidth: number
}

type FocusState = {
  start: number
  duration: number
  startDir: THREE.Vector3
  endDir: THREE.Vector3
  startDist: number
  endDist: number
}

type SceneApi = {
  renderer: THREE.WebGLRenderer
  scene: THREE.Scene
  camera: THREE.PerspectiveCamera
  controls: TrackballControls
  group: THREE.Group
  stage: HTMLDivElement
  lines: THREE.Object3D[]
  lineMaterials: LineMaterial[]
  frame: number
  focus: FocusState | null
  reducedMotion: boolean
  destroyed: boolean
}

function worldDirection(lat: number, lon: number, group: THREE.Group): THREE.Vector3 {
  return new THREE.Vector3(...latLonToVector3(lat, lon, 1))
    .applyQuaternion(group.quaternion)
    .normalize()
}

function surfacePoint(lat: number, lon: number, radius: number): THREE.Vector3 {
  return new THREE.Vector3(...latLonToVector3(lat, lon, radius))
}

function arcPoints(from: Stop, to: Stop, altitude: number, segments = 96): THREE.Vector3[] {
  const start = surfacePoint(from.lat, from.lon, 1).normalize()
  const end = surfacePoint(to.lat, to.lon, 1).normalize()
  const angle = start.angleTo(end)
  const quaternion = new THREE.Quaternion().setFromUnitVectors(start, end)
  const points: THREE.Vector3[] = []
  for (let i = 0; i <= segments; i += 1) {
    const t = i / segments
    const direction = start.clone().applyQuaternion(
      new THREE.Quaternion().identity().slerp(quaternion, t),
    )
    const lift = 1 + altitude * Math.sin(Math.PI * t) * Math.min(1, angle / 0.6)
    points.push(direction.multiplyScalar(lift))
  }
  return points
}

function legPoints(leg: Leg, from: Stop, to: Stop): { points: THREE.Vector3[]; dashed: boolean } {
  const directAngle = surfacePoint(from.lat, from.lon, 1).angleTo(surfacePoint(to.lat, to.lon, 1))
  if (leg.mode === 'plane') {
    return {
      points: arcPoints(from, to, clamp(0.035 + directAngle * 0.26, 0.035, 0.33)),
      dashed: true,
    }
  }
  if (leg.mode === 'ferry') {
    return { points: arcPoints(from, to, 0.006, 72), dashed: true }
  }
  if (leg.route?.points?.length) {
    const points = leg.route.points.map(([lon, lat]) => surfacePoint(lat, lon, 1.0045))
    return {
      points,
      dashed:
        leg.route.status !== 'routed' ||
        leg.mode === 'car' ||
        leg.mode === 'bus' ||
        leg.mode === 'bike' ||
        leg.mode === 'walk',
    }
  }
  return { points: arcPoints(from, to, 0, 72), dashed: true }
}

function dashFor(mode: Leg['mode'], dashed: boolean): { dashSize: number; gapSize: number } {
  if (!dashed) return { dashSize: 1, gapSize: 0 }
  if (mode === 'plane') return { dashSize: 0.034, gapSize: 0.02 }
  if (mode === 'ferry') return { dashSize: 0.038, gapSize: 0.022 }
  if (mode === 'bus') return { dashSize: 0.022, gapSize: 0.014 }
  if (mode === 'car') return { dashSize: 0.012, gapSize: 0.013 }
  if (mode === 'bike') return { dashSize: 0.007, gapSize: 0.009 }
  if (mode === 'walk') return { dashSize: 0.005, gapSize: 0.011 }
  return { dashSize: 0.018, gapSize: 0.014 }
}

function disposeLines(api: SceneApi): void {
  for (const object of api.lines) {
    api.group.remove(object)
    const line = object as Line2
    line.geometry.dispose()
    const material = line.material
    if (Array.isArray(material)) material.forEach((item) => item.dispose())
    else material.dispose()
  }
  api.lines = []
  api.lineMaterials = []
}

function rebuildLines(
  api: SceneApi,
  atlas: Atlas,
  activeJourneyId: string | null,
  showAll: boolean,
): void {
  disposeLines(api)
  const active = activeJourneyId ?? atlas.journeys[0]?.id ?? null
  const journeys = showAll
    ? atlas.journeys
    : atlas.journeys.filter((journey) => journey.id === active)

  for (const journey of journeys) {
    const isActive = journey.id === active
    const color = new THREE.Color(journeyColor(journey.color))
    for (let i = 0; i < journey.legs.length; i += 1) {
      const leg = journey.legs[i]
      const from = journey.stops[i]
      const to = journey.stops[i + 1]
      if (!from || !to) continue
      const { points, dashed } = legPoints(leg, from, to)
      if (points.length < 2) continue
      const positions: number[] = []
      for (const point of points) positions.push(point.x, point.y, point.z)
      const geometry = new LineGeometry()
      geometry.setPositions(positions)
      const dash = dashFor(leg.mode, dashed)
      const opacity = isActive ? 0.96 : 0.22
      const line = new Line2(
        geometry,
        new LineMaterial({
          color,
          linewidth: isActive ? 2.6 : 1.2,
          transparent: true,
          opacity,
          dashed,
          dashSize: dash.dashSize,
          gapSize: dash.gapSize,
          worldUnits: false,
          depthTest: true,
          depthWrite: false,
        }),
      )
      line.computeLineDistances()
      line.renderOrder = 3
      api.group.add(line)
      api.lines.push(line)
      api.lineMaterials.push(line.material as LineMaterial)

      if (isActive) {
        const haloGeometry = new LineGeometry()
        haloGeometry.setPositions(positions)
        const halo = new Line2(
          haloGeometry,
          new LineMaterial({
            color: HALO,
            linewidth: 5.8,
            transparent: true,
            opacity: 0.52,
            dashed: false,
            worldUnits: false,
            depthTest: true,
            depthWrite: false,
          }),
        )
        halo.computeLineDistances()
        halo.renderOrder = 2
        api.group.add(halo)
        api.lines.push(halo)
        api.lineMaterials.push(halo.material as LineMaterial)
      }
    }
  }
}

function projectPins(api: SceneApi, pins: PinData[], elements: Map<string, HTMLButtonElement>): void {
  const width = api.stage.clientWidth
  const height = api.stage.clientHeight
  if (!width || !height) return
  const cameraDir = api.camera.position.clone().normalize()
  const point = new THREE.Vector3()
  type VisiblePin = {
    pin: PinData
    element: HTMLButtonElement
    x: number
    y: number
    trueX: number
    trueY: number
    opacity: number
    labelSide: 'left' | 'right'
  }
  const visible: VisiblePin[] = []

  for (const pin of pins) {
    const element = elements.get(pin.key)
    if (!element) continue
    point.set(...latLonToVector3(pin.lat, pin.lon, 1.002)).applyQuaternion(api.group.quaternion)
    const normal = point.clone().normalize()
    const facing = normal.dot(cameraDir)
    const projected = point.clone().project(api.camera)
    const x = (projected.x * 0.5 + 0.5) * width
    const y = (-projected.y * 0.5 + 0.5) * height
    const isVisible = facing > 0.035 && projected.z > -1 && projected.z < 1
    const fade = clamp((facing - 0.035) / 0.14, 0, 1)
    element.style.transform = `translate3d(${x}px, ${y}px, 0)`
    element.style.opacity = isVisible ? String(fade) : '0'
    element.style.pointerEvents = isVisible ? 'auto' : 'none'
    element.dataset.labelSide = 'right'
    if (isVisible) {
      visible.push({
        pin,
        element,
        x,
        y,
        trueX: x,
        trueY: y,
        opacity: fade,
        labelSide: 'right',
      })
    }
  }

  // When several active stops sit on top of each other at a country-scale
  // view, fan them out into a small rosette so every stop stays clickable.
  const activePins = visible.filter((entry) => entry.pin.active)
  const clusterThreshold = clamp(width / 55, 12, 26)
  const clusterBase = width < 600 ? 12 : 18
  const clusterStep = width < 600 ? 2 : 3
  const clusterMax = width < 600 ? 12 : 16
  const groups: VisiblePin[][] = []
  for (const entry of activePins) {
    const group = groups.find((candidate) => {
      const cx = candidate.reduce((sum, item) => sum + item.trueX, 0) / candidate.length
      const cy = candidate.reduce((sum, item) => sum + item.trueY, 0) / candidate.length
      return Math.hypot(entry.trueX - cx, entry.trueY - cy) < clusterThreshold
    })
    if (group) group.push(entry)
    else groups.push([entry])
  }
  for (const group of groups) {
    if (group.length < 2) continue
    const cx = group.reduce((sum, item) => sum + item.trueX, 0) / group.length
    const cy = group.reduce((sum, item) => sum + item.trueY, 0) / group.length
    const radius = clusterBase + Math.min(clusterMax, group.length * clusterStep)
    group.forEach((entry, index) => {
      const angle = -Math.PI / 2 + (index * Math.PI * 2) / group.length
      entry.x = cx + Math.cos(angle) * radius
      entry.y = cy + Math.sin(angle) * radius
      entry.labelSide = Math.cos(angle) < -0.2 ? 'left' : 'right'
      entry.element.dataset.labelSide = entry.labelSide
      entry.element.style.transform = `translate3d(${entry.x}px, ${entry.y}px, 0)`
    })
  }

  // Labels are only shown for the active journey, the selected stop, or hover.
  const labelCandidates = visible
    .filter((entry) => entry.pin.active || entry.pin.selected)
    .sort((a, b) => {
      if (a.pin.selected !== b.pin.selected) return a.pin.selected ? -1 : 1
      return a.y - b.y
    })
  const rectangles: Array<{ x: number; y: number; w: number; h: number }> = []
  for (const entry of labelCandidates) {
    const rectangle = {
      x: entry.labelSide === 'left' ? entry.x - 14 - entry.pin.labelWidth : entry.x + 14,
      y: entry.y - 10,
      w: entry.pin.labelWidth,
      h: 20,
    }
    const collides =
      !entry.pin.selected &&
      rectangles.some(
        (other) =>
          rectangle.x < other.x + other.w &&
          rectangle.x + rectangle.w > other.x &&
          rectangle.y < other.y + other.h &&
          rectangle.y + rectangle.h > other.y,
      )
    entry.element.style.setProperty('--label-opacity', collides ? '0' : String(entry.opacity))
    rectangles.push(rectangle)
  }
  for (const entry of visible) {
    if (!entry.pin.active && !entry.pin.selected) {
      entry.element.style.setProperty('--label-opacity', '0')
    }
  }
}

function focusDirection(api: SceneApi, direction: THREE.Vector3, distance: number): void {
  const startDir = api.camera.position.clone().normalize()
  const startDist = api.camera.position.length()
  const endDir = direction.clone().normalize()
  api.camera.up.set(0, 1, 0)
  if (api.reducedMotion) {
    api.camera.position.copy(endDir.multiplyScalar(distance))
    api.camera.lookAt(0, 0, 0)
    api.controls.enabled = true
    api.controls.update()
    return
  }
  api.controls.enabled = false
  api.focus = {
    start: performance.now(),
    duration: 950,
    startDir,
    endDir,
    startDist,
    endDist: distance,
  }
}

function journeyFocus(journey: Journey, group: THREE.Group): { dir: THREE.Vector3; distance: number } {
  if (!journey.stops.length) {
    return { dir: worldDirection(24, 106, group), distance: 3.6 }
  }
  const vectors = journey.stops.map((stop) => worldDirection(stop.lat, stop.lon, group))
  const center = vectors.reduce((sum, vector) => sum.add(vector), new THREE.Vector3())
  if (center.lengthSq() < 0.0001) {
    return { dir: vectors[0], distance: 3.5 }
  }
  center.normalize()
  let spread = 0
  for (const vector of vectors) {
    spread = Math.max(spread, Math.acos(clamp(vector.dot(center), -1, 1)))
  }
  return {
    dir: center,
    distance: clamp(3.1 + spread * 1.35, 3.1, 4.5),
  }
}

export function Globe(): React.ReactElement {
  const { t } = useT()
  const atlas = useAtlasStore((state) => state.atlas)
  const selectedJourneyId = useUIStore((state) => state.selectedJourneyId)
  const selectedStopId = useUIStore((state) => state.selectedStopId)
  const showAll = useUIStore((state) => state.showAll)
  const selectStop = useUIStore((state) => state.selectStop)
  const locale = useUIStore((state) => state.locale)
  const [textureState, setTextureState] = useState<TextureState>('loading')
  const stageRef = useRef<HTMLDivElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const apiRef = useRef<SceneApi | null>(null)
  const pinElements = useRef<Map<string, HTMLButtonElement>>(new Map())
  const atlasRef = useRef<Atlas | null>(atlas)
  atlasRef.current = atlas
  const pinDataRef = useRef<PinData[]>([])

  const pinData = useMemo<PinData[]>(() => {
    if (!atlas) return []
    const activeId = selectedJourneyId ?? atlas.journeys[0]?.id
    const journeys = showAll
      ? atlas.journeys
      : atlas.journeys.filter((journey) => journey.id === activeId)
    const pins: PinData[] = []
    for (const journey of journeys) {
      const isActive = journey.id === activeId
      for (let index = 0; index < journey.stops.length; index += 1) {
        const stop = journey.stops[index]
        const label = stopName(stop, locale)
        const characters = Array.from(label).length
        const cjk = /[\u3400-\u9fff]/.test(label)
        pins.push({
          key: `${journey.id}:${stop.id}`,
          journeyId: journey.id,
          stopId: stop.id,
          lat: stop.lat,
          lon: stop.lon,
          label,
          index: index + 1,
          active: isActive,
          selected: selectedStopId === stop.id && selectedJourneyId === journey.id,
          color: journeyColor(journey.color),
          labelWidth: Math.min(cjk ? 168 : 190, characters * (cjk ? 15 : 7.2) + 20),
        })
      }
    }
    return pins
  }, [atlas, locale, selectedJourneyId, selectedStopId, showAll])

  pinDataRef.current = pinData

  const routeSignature = useMemo(() => {
    if (!atlas) return ''
    return JSON.stringify(
      atlas.journeys.map((journey) => ({
        id: journey.id,
        color: journey.color,
        stops: journey.stops.map((stop) => [stop.id, stop.lat, stop.lon]),
        legs: journey.legs.map((leg) => [
          leg.mode,
          leg.route?.provider,
          leg.route?.distanceKm,
          leg.route?.status,
          leg.route?.points?.length,
          leg.connection?.summary,
          leg.connection?.depart,
          leg.connection?.arrive,
        ]),
      })),
    )
  }, [atlas])

  useEffect(() => {
    const stage = stageRef.current
    const canvas = canvasRef.current
    if (!stage || !canvas) return
    let api: SceneApi | null = null
    let observer: ResizeObserver | null = null
    let onStart: (() => void) | null = null

    try {
      const renderer = new THREE.WebGLRenderer({
        canvas,
        antialias: true,
        alpha: true,
        powerPreference: 'high-performance',
      })
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
      renderer.setSize(stage.clientWidth, stage.clientHeight, false)
      renderer.outputColorSpace = THREE.SRGBColorSpace
      renderer.toneMapping = THREE.NoToneMapping

      const scene = new THREE.Scene()
      const camera = new THREE.PerspectiveCamera(
        42,
        Math.max(stage.clientWidth, 1) / Math.max(stage.clientHeight, 1),
        0.05,
        100,
      )
      const group = new THREE.Group()
      scene.add(group)

      const globeMaterial = new THREE.MeshStandardMaterial({
        color: new THREE.Color('#ece2cd'),
        roughness: 0.94,
        metalness: 0,
      })
      const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 96, 64), globeMaterial)
      group.add(sphere)

      const rimMaterial = new THREE.ShaderMaterial({
        uniforms: {
          uColor: { value: new THREE.Color('#b99767') },
        },
        vertexShader: `
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            vec4 mv = modelViewMatrix * vec4(position, 1.0);
            vNormal = normalize(normalMatrix * normal);
            vView = normalize(-mv.xyz);
            gl_Position = projectionMatrix * mv;
          }
        `,
        fragmentShader: `
          uniform vec3 uColor;
          varying vec3 vNormal;
          varying vec3 vView;
          void main() {
            float rim = pow(1.0 - max(dot(vNormal, vView), 0.0), 3.0);
            gl_FragColor = vec4(uColor, rim * 0.22);
          }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      })
      const rim = new THREE.Mesh(new THREE.SphereGeometry(1.006, 64, 48), rimMaterial)
      group.add(rim)

      scene.add(new THREE.AmbientLight(0xfff5e4, 2.15))
      const keyLight = new THREE.DirectionalLight(0xffecd2, 0.85)
      keyLight.position.set(-2.5, 3.5, 4)
      scene.add(keyLight)
      const fillLight = new THREE.DirectionalLight(0xe8dcc0, 0.28)
      fillLight.position.set(3, -1, -2)
      scene.add(fillLight)

      const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
      const initialDir = worldDirection(26, 108, group)
      camera.up.set(0, 1, 0)
      camera.position.copy(initialDir.multiplyScalar(3.6))
      camera.lookAt(0, 0, 0)

      const controls = new TrackballControls(camera, canvas)
      controls.target.set(0, 0, 0)
      controls.rotateSpeed = 1
      controls.zoomSpeed = 1.25
      controls.panSpeed = 0
      controls.noPan = true
      controls.staticMoving = false
      controls.dynamicDampingFactor = 0.12
      controls.minDistance = 1.7
      controls.maxDistance = 6
      controls.handleResize()
      controls.update()

      api = {
        renderer,
        scene,
        camera,
        controls,
        group,
        stage,
        lines: [],
        lineMaterials: [],
        frame: 0,
        focus: null,
        reducedMotion,
        destroyed: false,
      }
      const current = api
      apiRef.current = current

      onStart = () => {
        if (current.focus) {
          current.focus = null
          current.controls.enabled = true
          current.controls.update()
        }
      }
      controls.addEventListener('start', onStart)

      void loadGlobeTexture(renderer, {
        onBase: (texture) => {
          if (current.destroyed) {
            texture.dispose()
            return
          }
          globeMaterial.map = texture
          globeMaterial.color.set(0xffffff)
          globeMaterial.needsUpdate = true
          setTextureState('ready')
        },
        onHighResolution: (texture) => {
          if (current.destroyed) {
            texture.dispose()
            return
          }
          const previous = globeMaterial.map
          globeMaterial.map = texture
          globeMaterial.needsUpdate = true
          previous?.dispose()
        },
        onProgress: (progress) => {
          if (current.destroyed) return
          if (progress.stage === 'loading') setTextureState('loading')
          if (progress.stage === 'error') setTextureState('error')
          if (progress.stage === 'ready') setTextureState('ready')
        },
      }).catch(() => {
        if (!current.destroyed) setTextureState('error')
      })

      const resize = () => {
        const width = Math.max(stage.clientWidth, 1)
        const height = Math.max(stage.clientHeight, 1)
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2))
        renderer.setSize(width, height, false)
        camera.aspect = width / height
        camera.updateProjectionMatrix()
        controls.handleResize()
        for (const material of current.lineMaterials) {
          material.resolution.set(width, height)
        }
      }
      observer = new ResizeObserver(resize)
      observer.observe(stage)
      resize()

      const animate = () => {
        if (current.destroyed) return
        current.frame = window.requestAnimationFrame(animate)
        const now = performance.now()
        if (current.focus) {
          const t = clamp((now - current.focus.start) / current.focus.duration, 0, 1)
          const eased = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
          const quaternion = new THREE.Quaternion().setFromUnitVectors(
            current.focus.startDir,
            current.focus.endDir,
          )
          const direction = current.focus.startDir
            .clone()
            .applyQuaternion(new THREE.Quaternion().identity().slerp(quaternion, eased))
          const distance =
            current.focus.startDist +
            (current.focus.endDist - current.focus.startDist) * eased
          current.camera.position.copy(direction.multiplyScalar(distance))
          current.camera.lookAt(0, 0, 0)
          if (t >= 1) {
            current.focus = null
            current.controls.enabled = true
            current.controls.update()
          }
        } else {
          current.controls.update()
        }
        projectPins(current, pinDataRef.current, pinElements.current)
        renderer.render(scene, camera)
      }
      current.frame = window.requestAnimationFrame(animate)
    } catch {
      setTextureState('error')
    }

    return () => {
      if (api) {
        api.destroyed = true
        window.cancelAnimationFrame(api.frame)
        observer?.disconnect()
        if (onStart) api.controls.removeEventListener('start', onStart)
        disposeLines(api)
        api.controls.dispose()
        api.scene.traverse((object) => {
          if (object instanceof THREE.Mesh) {
            object.geometry.dispose()
            const material = object.material
            if (Array.isArray(material)) material.forEach((item) => item.dispose())
            else if (material) {
              const map = (material as THREE.MeshStandardMaterial).map
              map?.dispose()
              material.dispose()
            }
          }
        })
        api.renderer.dispose()
      }
      apiRef.current = null
      pinElements.current.clear()
    }
  }, [])

  useEffect(() => {
    const api = apiRef.current
    const currentAtlas = atlasRef.current
    if (!api || !currentAtlas) return
    const active = selectedJourneyId ?? currentAtlas.journeys[0]?.id ?? null
    rebuildLines(api, currentAtlas, active, showAll)
    for (const material of api.lineMaterials) {
      material.resolution.set(api.stage.clientWidth, api.stage.clientHeight)
    }
  }, [routeSignature, selectedJourneyId, showAll])

  useEffect(() => {
    const api = apiRef.current
    const currentAtlas = atlasRef.current
    if (!api || !currentAtlas) return
    const journey =
      currentAtlas.journeys.find((item) => item.id === selectedJourneyId) ??
      currentAtlas.journeys[0]
    if (!journey) return
    if (selectedStopId) {
      const stop = journey.stops.find((item) => item.id === selectedStopId)
      if (stop) {
        focusDirection(
          api,
          worldDirection(stop.lat, stop.lon, api.group),
          Math.min(2.65, api.controls.maxDistance),
        )
        return
      }
    }
    const focus = journeyFocus(journey, api.group)
    focusDirection(api, focus.dir, focus.distance)
  }, [selectedJourneyId, selectedStopId, textureState === 'ready', atlas?.journeys.length])

  return (
    <div className={`globe-stage is-${textureState}`} ref={stageRef}>
      <div className="globe-halo" aria-hidden="true" />
      <canvas className="globe-canvas" ref={canvasRef} aria-hidden="true" />
      <div className="globe-pins">
        {pinData.map((pin) => (
          <button
            key={pin.key}
            ref={(element) => {
              if (element) pinElements.current.set(pin.key, element)
              else pinElements.current.delete(pin.key)
            }}
            type="button"
            className={`globe-pin ${pin.active ? 'is-active' : 'is-muted'} ${
              pin.selected ? 'is-selected' : ''
            }`}
            style={{ '--pin-color': pin.color } as CSSProperties}
            onClick={() => selectStop(pin.journeyId, pin.stopId)}
            aria-label={`${pin.label}${pin.active ? ` · ${pin.index}` : ''}`}
            aria-pressed={pin.selected}
          >
            <span className="pin-dot">
              <span className="pin-number">{pin.index}</span>
            </span>
            <span className="pin-label">{pin.label}</span>
          </button>
        ))}
      </div>
      {textureState !== 'ready' && (
        <div className="globe-loading" aria-live="polite">
          <div className="globe-loading-orb" aria-hidden="true" />
          <p>{textureState === 'error' ? t('error') : t('loading')}</p>
        </div>
      )}
    </div>
  )
}
