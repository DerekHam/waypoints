import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import {
  createLeg,
  journeyTitle,
  makeId,
  parseAtlas,
  safeParseAtlas,
  stopName,
  type Atlas,
  type Journey,
  type JourneyColor,
  type Leg,
  type Locale,
  type RailConnection,
  type Stop,
} from '@shared/atlas'
import { siteConfig } from '@/config'
import { loadPublicAtlas, readUrlSelection, writeUrlSelection } from '@/lib/data'
import { ApiError, ConflictError, computeRoute, fetchAtlas, loginWithKey, saveAtlas } from '@/lib/api'
import { clearDraft, loadDraft, saveDraft, type Draft } from '@/lib/draft'
import {
  clearSession,
  loadLocalAtlas,
  loadSession,
  storeLocalAtlas,
  storeSession,
  type Session,
} from '@/lib/session'
import { downloadText, haversineKm, legDistanceKm } from '@/lib/geo'

const COLORS: JourneyColor[] = ['terracotta', 'indigo', 'sage', 'ochre', 'plum', 'slate']

function detectLocale(): Locale {
  try {
    const stored = localStorage.getItem('waypoints.locale')
    if (stored === 'en' || stored === 'zh') return stored
    return typeof navigator !== 'undefined' && navigator.language.toLowerCase().startsWith('zh')
      ? 'zh'
      : 'en'
  } catch {
    return 'en'
  }
}

type Toast = {
  id: number
  message: string
  undo?: boolean
}

type UIState = {
  locale: Locale
  setLocale: (locale: Locale) => void
  selectedJourneyId: string | null
  selectedStopId: string | null
  selectJourney: (journeyId: string | null) => void
  selectStop: (journeyId: string, stopId: string) => void
  clearStop: () => void
  showAll: boolean
  toggleShowAll: () => void
  indexOpen: boolean
  setIndexOpen: (open: boolean) => void
  panelCollapsed: boolean
  togglePanel: () => void
  toast: Toast | null
  showToast: (message: string, undo?: boolean) => void
  clearToast: () => void
}

export const useUIStore = create<UIState>()(
  persist(
    (set) => ({
      locale: detectLocale(),
      setLocale: (locale) => {
        localStorage.setItem('waypoints.locale', locale)
        document.documentElement.lang = locale === 'zh' ? 'zh-CN' : 'en'
        set({ locale })
      },
      selectedJourneyId: null,
      selectedStopId: null,
      selectJourney: (journeyId) => {
        writeUrlSelection(journeyId, null)
        set({ selectedJourneyId: journeyId, selectedStopId: null, indexOpen: false })
      },
      selectStop: (journeyId, stopId) => {
        writeUrlSelection(journeyId, stopId)
        set({ selectedJourneyId: journeyId, selectedStopId: stopId, indexOpen: false })
      },
      clearStop: () => {
        const journeyId = useUIStore.getState().selectedJourneyId
        writeUrlSelection(journeyId, null)
        set({ selectedStopId: null })
      },
      showAll: true,
      toggleShowAll: () => set((state) => ({ showAll: !state.showAll })),
      indexOpen: false,
      setIndexOpen: (indexOpen) => set({ indexOpen }),
      panelCollapsed: false,
      togglePanel: () => set((state) => ({ panelCollapsed: !state.panelCollapsed })),
      toast: null,
      showToast: (message, undo) => set({ toast: { id: Date.now(), message, undo } }),
      clearToast: () => set({ toast: null }),
    }),
    {
      name: 'waypoints.ui.v1',
      partialize: (state) => ({ locale: state.locale }),
    },
  ),
)

type SaveState = 'idle' | 'saving' | 'preparing' | 'saved' | 'error'

type Conflict = {
  remote: Atlas
  remoteSha: string
  local: Atlas
}

type AtlasState = {
  atlas: Atlas | null
  publicAtlas: Atlas | null
  baseline: Atlas | null
  baseSha: string | null
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  dirty: boolean
  editMode: boolean
  session: Session | null
  authOpen: boolean
  authBusy: boolean
  authError: string | null
  saveState: SaveState
  saveError: string | null
  conflict: Conflict | null
  draftAvailable: Draft | null
  history: Atlas[]
  routePending: Record<string, boolean>
  load: () => Promise<void>
  setLocaleSelection: () => void
  openAuth: () => void
  closeAuth: () => void
  login: (key: string) => Promise<void>
  loginLocal: () => void
  logout: () => void
  setEditMode: (value: boolean) => void
  save: () => Promise<void>
  discardChanges: () => void
  resolveConflictLoad: () => void
  resolveConflictOverwrite: () => Promise<void>
  downloadConflictCopy: () => void
  restoreDraft: () => void
  discardDraft: () => void
  addJourney: () => string | null
  updateJourney: (journeyId: string, patch: Partial<Journey>, recordHistory?: boolean) => void
  deleteJourney: (journeyId: string) => void
  duplicateJourney: (journeyId: string) => void
  addStop: (journeyId: string, stop: Stop) => void
  updateStop: (journeyId: string, stopId: string, patch: Partial<Stop>) => void
  deleteStop: (journeyId: string, stopId: string) => void
  moveStop: (journeyId: string, stopId: string, direction: -1 | 1) => void
  updateLeg: (journeyId: string, index: number, patch: Partial<Leg>) => void
  setConnection: (journeyId: string, index: number, connection: RailConnection | null) => void
  refreshRoute: (journeyId: string, index: number) => Promise<void>
  prepareRoutes: () => Promise<Atlas | null>
  undo: () => void
}

function selectInitialJourney(atlas: Atlas): void {
  const { journeyId, stopId } = readUrlSelection()
  const journey = atlas.journeys.find((item) => item.id === journeyId) ?? atlas.journeys[0]
  if (!journey) {
    useUIStore.setState({ selectedJourneyId: null, selectedStopId: null })
    return
  }
  const stop = stopId ? journey.stops.find((item) => item.id === stopId) : undefined
  if (stop) {
    useUIStore.setState({ selectedJourneyId: journey.id, selectedStopId: stop.id })
    writeUrlSelection(journey.id, stop.id)
  } else {
    useUIStore.setState({ selectedJourneyId: journey.id, selectedStopId: null })
    writeUrlSelection(journey.id, null)
  }
}

function touch(atlas: Atlas, editor?: string): void {
  atlas.updatedAt = new Date().toISOString()
  if (editor) atlas.lastEditedBy = editor
}

function clearAdjacentRoutes(journey: Journey, stopIndex: number): void {
  const before = journey.legs[stopIndex - 1]
  const after = journey.legs[stopIndex]
  if (before) {
    before.route = null
    before.connection = null
  }
  if (after) {
    after.route = null
    after.connection = null
  }
}

function clearAllRoutes(journey: Journey): void {
  for (const leg of journey.legs) {
    leg.route = null
    leg.connection = null
  }
}

function tierRoute(leg: Leg, from: Stop, to: Stop): boolean {
  const direct = haversineKm([from.lon, from.lat], [to.lon, to.lat])
  if (leg.mode === 'plane') {
    const changed =
      leg.route?.provider !== 'great-circle' ||
      Math.abs((leg.route?.distanceKm ?? 0) - direct) > 1
    leg.route = {
      provider: 'great-circle',
      distanceKm: Math.round(direct * 10) / 10,
      status: 'routed',
    }
    return changed
  }
  if (leg.mode === 'ferry') {
    const changed =
      leg.route?.provider !== 'schematic' ||
      Math.abs((leg.route?.distanceKm ?? 0) - direct) > 1
    leg.route = {
      provider: 'schematic',
      distanceKm: Math.round(direct * 10) / 10,
      status: 'estimated',
    }
    return changed
  }
  return false
}

export const useAtlasStore = create<AtlasState>()((set, get) => ({
  atlas: null,
  publicAtlas: null,
  baseline: null,
  baseSha: null,
  status: 'idle',
  error: null,
  dirty: false,
  editMode: false,
  session: loadSession(),
  authOpen: false,
  authBusy: false,
  authError: null,
  saveState: 'idle',
  saveError: null,
  conflict: null,
  draftAvailable: null,
  history: [],
  routePending: {},

  load: async () => {
    set({ status: 'loading', error: null })
    const session = get().session
    let publicAtlas: Atlas | null = null
    let atlas: Atlas | null = null
    let baseSha: string | null = null
    let usedRemote = false

    try {
      publicAtlas = await loadPublicAtlas()
    } catch {
      publicAtlas = null
    }

    if (session?.mode === 'relay' && session.token) {
      try {
        const remote = await fetchAtlas(session.token)
        atlas = parseAtlas(remote.atlas)
        baseSha = remote.sha
        usedRemote = true
      } catch (error) {
        if (error instanceof ApiError && error.status === 401) {
          clearSession()
          set({ session: null })
        }
      }
    }

    if (!atlas && session?.mode === 'local') {
      const local = loadLocalAtlas()
      if (local) {
        try {
          atlas = parseAtlas(local)
          baseSha = null
          usedRemote = true
        } catch {
          atlas = null
        }
      }
    }

    if (!atlas) atlas = publicAtlas

    if (!atlas) {
      set({ status: 'error', error: 'Could not load the atlas' })
      return
    }

    const baseline = structuredClone(atlas)
    const draft = loadDraft()
    const draftAvailable =
      session && draft && JSON.stringify(draft.atlas) !== JSON.stringify(atlas) ? draft : null

    set({
      atlas,
      publicAtlas: publicAtlas ? structuredClone(publicAtlas) : structuredClone(atlas),
      baseline,
      baseSha,
      status: 'ready',
      dirty: false,
      error: null,
      editMode: Boolean(session),
      draftAvailable,
      history: [],
      routePending: {},
    })
    selectInitialJourney(atlas)
    if (usedRemote && session?.mode === 'relay') {
      // The remote atlas is authoritative; keep the public copy for logout.
      set({ publicAtlas: publicAtlas ?? structuredClone(atlas) })
    }
  },

  setLocaleSelection: () => {
    const atlas = get().atlas
    if (atlas) selectInitialJourney(atlas)
  },

  openAuth: () => set({ authOpen: true, authError: null }),
  closeAuth: () => set({ authOpen: false, authBusy: false, authError: null }),

  login: async (key) => {
    set({ authBusy: true, authError: null })
    try {
      const response = await loginWithKey(key)
      const session: Session = {
        mode: 'relay',
        token: response.token,
        editor: response.editor,
        expiresAt: response.expiresAt,
      }
      storeSession(session)
      const remote = await fetchAtlas(response.token)
      const atlas = parseAtlas(remote.atlas)
      const draft = loadDraft()
      set({
        session,
        atlas,
        publicAtlas: get().publicAtlas ?? structuredClone(atlas),
        baseline: structuredClone(atlas),
        baseSha: remote.sha,
        dirty: false,
        editMode: true,
        authOpen: false,
        authBusy: false,
        authError: null,
        history: [],
        draftAvailable:
          draft && JSON.stringify(draft.atlas) !== JSON.stringify(atlas) ? draft : null,
      })
      selectInitialJourney(atlas)
      useUIStore.getState().showToast(useUIStore.getState().locale === 'zh' ? '编辑已解锁' : 'Editing unlocked')
    } catch (error) {
      const message =
        error instanceof ApiError
          ? error.status === 401
            ? 'invalid'
            : error.status === 429
              ? 'rate'
              : error.code === 'not_configured'
                ? 'not_configured'
                : error.code === 'network' || error.code === 'timeout'
                  ? 'network'
                  : 'save'
          : 'network'
      set({ authBusy: false, authError: message })
    }
  },

  loginLocal: () => {
    const session: Session = { mode: 'local', editor: 'Local preview' }
    storeSession(session)
    const local = loadLocalAtlas()
    const atlas = local ? parseAtlas(local) : get().atlas
    if (atlas) {
      set({
        session,
        atlas,
        baseline: structuredClone(atlas),
        dirty: false,
        editMode: true,
        authOpen: false,
        authError: null,
      })
      selectInitialJourney(atlas)
      useUIStore.getState().showToast(
        useUIStore.getState().locale === 'zh' ? '本地预览已开启' : 'Local preview enabled',
      )
    }
  },

  logout: () => {
    const { atlas, session, dirty } = get()
    if (dirty && atlas && session) {
      saveDraft({
        atlas,
        baseSha: get().baseSha,
        savedAt: new Date().toISOString(),
        sessionMode: session.mode,
      })
    }
    clearSession()
    const publicAtlas = get().publicAtlas
    set({
      session: null,
      editMode: false,
      dirty: false,
      atlas: publicAtlas ? structuredClone(publicAtlas) : atlas,
      baseline: publicAtlas ? structuredClone(publicAtlas) : get().baseline,
      baseSha: null,
      authOpen: false,
      history: [],
      saveState: 'idle',
    })
    if (publicAtlas) selectInitialJourney(publicAtlas)
  },

  setEditMode: (value) => set({ editMode: value }),

  save: async () => {
    const { atlas, session } = get()
    if (!atlas) return
    if (!session) {
      get().openAuth()
      return
    }
    const validation = safeParseAtlas(atlas)
    if (!validation.success) {
      const first = validation.error.issues[0]
      set({ saveState: 'error', saveError: first?.message ?? 'Invalid atlas data' })
      useUIStore.getState().showToast(
        useUIStore.getState().locale === 'zh'
          ? '有内容无法保存，请检查表单'
          : 'Some fields need attention before saving',
      )
      return
    }
    if (session.mode === 'local') {
      storeLocalAtlas(atlas)
      set({
        baseline: structuredClone(atlas),
        dirty: false,
        saveState: 'saved',
        saveError: null,
        history: [],
      })
      clearDraft()
      useUIStore.getState().showToast(
        useUIStore.getState().locale === 'zh'
          ? '已保存到本地预览'
          : 'Saved to local preview',
      )
      return
    }
    if (!session.token) {
      set({ authOpen: true, authError: 'expired' })
      return
    }

    set({ saveState: 'preparing', saveError: null, conflict: null })
    const prepared = await get().prepareRoutes()
    if (!prepared) return
    set({ saveState: 'saving' })
    try {
      const result = await saveAtlas(session.token, prepared, get().baseSha)
      const saved = parseAtlas(result.atlas)
      set({
        atlas: saved,
        baseline: structuredClone(saved),
        baseSha: result.sha,
        dirty: false,
        saveState: 'saved',
        saveError: null,
        history: [],
        conflict: null,
      })
      clearDraft()
      useUIStore.getState().showToast(
        useUIStore.getState().locale === 'zh'
          ? '已保存，公开页面稍后更新'
          : 'Saved. The public page updates shortly.',
      )
    } catch (error) {
      if (error instanceof ConflictError) {
        set({
          conflict: {
            remote: parseAtlas(error.remote),
            remoteSha: error.remoteSha,
            local: prepared,
          },
          saveState: 'idle',
        })
        return
      }
      if (error instanceof ApiError && error.status === 401) {
        clearSession()
        set({
          session: null,
          editMode: false,
          authOpen: true,
          authError: 'expired',
          saveState: 'error',
          saveError: 'session',
        })
        return
      }
      set({
        saveState: 'error',
        saveError: error instanceof Error ? error.message : 'save',
      })
      useUIStore.getState().showToast(
        useUIStore.getState().locale === 'zh' ? '保存失败' : 'Could not save',
      )
    }
  },

  discardChanges: () => {
    const baseline = get().baseline
    if (!baseline) return
    set({
      atlas: structuredClone(baseline),
      dirty: false,
      history: [],
      saveState: 'idle',
      saveError: null,
    })
    clearDraft()
  },

  resolveConflictLoad: () => {
    const conflict = get().conflict
    if (!conflict) return
    const remote = structuredClone(conflict.remote)
    set({
      atlas: remote,
      baseline: structuredClone(remote),
      baseSha: conflict.remoteSha,
      conflict: null,
      dirty: false,
      history: [],
      saveState: 'idle',
    })
    clearDraft()
    selectInitialJourney(remote)
  },

  resolveConflictOverwrite: async () => {
    const { conflict, session, atlas } = get()
    if (!conflict || !session?.token || !atlas) return
    set({ conflict: null, saveState: 'saving' })
    try {
      const result = await saveAtlas(session.token, atlas, conflict.remoteSha, true)
      const saved = parseAtlas(result.atlas)
      set({
        atlas: saved,
        baseline: structuredClone(saved),
        baseSha: result.sha,
        dirty: false,
        saveState: 'saved',
        saveError: null,
        history: [],
      })
      clearDraft()
      useUIStore.getState().showToast(
        useUIStore.getState().locale === 'zh' ? '已覆盖保存' : 'Saved over the newer version',
      )
    } catch (error) {
      set({
        saveState: 'error',
        saveError: error instanceof Error ? error.message : 'save',
      })
    }
  },

  downloadConflictCopy: () => {
    const { atlas } = get()
    if (!atlas) return
    downloadText('waypoints-my-copy.json', JSON.stringify(atlas, null, 2))
  },

  restoreDraft: () => {
    const draft = get().draftAvailable
    if (!draft) return
    set({
      atlas: parseAtlas(draft.atlas),
      baseSha: draft.baseSha,
      dirty: true,
      editMode: true,
      draftAvailable: null,
    })
    selectInitialJourney(parseAtlas(draft.atlas))
    useUIStore.getState().showToast(
      useUIStore.getState().locale === 'zh' ? '草稿已恢复' : 'Draft restored',
    )
  },

  discardDraft: () => {
    clearDraft()
    set({ draftAvailable: null })
  },

  addJourney: () => {
    const atlas = get().atlas
    if (!atlas) return null
    const next = structuredClone(atlas)
    const used = new Set(next.journeys.map((journey) => journey.color))
    const color = COLORS.find((item) => !used.has(item)) ?? COLORS[next.journeys.length % COLORS.length]
    const now = new Date().toISOString()
    const journey: Journey = {
      id: makeId('journey'),
      title: 'New journey',
      titleZh: '新旅程',
      subtitle: '',
      subtitleZh: '',
      note: '',
      noteZh: '',
      color,
      stops: [],
      legs: [],
      createdAt: now,
      updatedAt: now,
    }
    next.journeys.push(journey)
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: [...get().history, structuredClone(atlas)].slice(-20),
      editMode: true,
    })
    useUIStore.setState({ selectedJourneyId: journey.id, selectedStopId: null })
    writeUrlSelection(journey.id, null)
    return journey.id
  },

  updateJourney: (journeyId, patch, recordHistory = false) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    if (!journey) return
    Object.assign(journey, patch, { updatedAt: new Date().toISOString() })
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: recordHistory
        ? [...get().history, structuredClone(atlas)].slice(-20)
        : get().history,
    })
  },

  deleteJourney: (journeyId) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const index = next.journeys.findIndex((item) => item.id === journeyId)
    if (index === -1) return
    next.journeys.splice(index, 1)
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: [...get().history, structuredClone(atlas)].slice(-20),
    })
    const nextJourney = next.journeys[Math.min(index, next.journeys.length - 1)]
    useUIStore.setState({
      selectedJourneyId: nextJourney?.id ?? null,
      selectedStopId: null,
    })
    writeUrlSelection(nextJourney?.id ?? null, null)
  },

  duplicateJourney: (journeyId) => {
    const atlas = get().atlas
    if (!atlas) return
    const source = atlas.journeys.find((item) => item.id === journeyId)
    if (!source) return
    const next = structuredClone(atlas)
    const copy = structuredClone(source)
    copy.id = makeId('journey')
    copy.title = `${source.title} (copy)`
    copy.titleZh = source.titleZh ? `${source.titleZh}（副本）` : '副本'
    copy.createdAt = new Date().toISOString()
    copy.updatedAt = copy.createdAt
    const stopMap = new Map<string, string>()
    copy.stops = copy.stops.map((stop) => {
      const newId = makeId('stop')
      stopMap.set(stop.id, newId)
      return { ...stop, id: newId }
    })
    copy.legs = copy.legs.map((leg) => ({
      ...leg,
      route: leg.route ? structuredClone(leg.route) : null,
      connection: leg.connection ? structuredClone(leg.connection) : null,
    }))
    next.journeys.push(copy)
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: [...get().history, structuredClone(atlas)].slice(-20),
    })
    useUIStore.setState({ selectedJourneyId: copy.id, selectedStopId: null })
    writeUrlSelection(copy.id, null)
  },

  addStop: (journeyId, stop) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    if (!journey) return
    journey.stops.push(stop)
    if (journey.stops.length > 1) journey.legs.push(createLeg('train'))
    journey.updatedAt = new Date().toISOString()
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: [...get().history, structuredClone(atlas)].slice(-20),
      editMode: true,
    })
    useUIStore.setState({ selectedJourneyId: journeyId, selectedStopId: stop.id })
    writeUrlSelection(journeyId, stop.id)
    const index = journey.legs.length - 1
    if (index >= 0) void get().refreshRoute(journeyId, index)
  },

  updateStop: (journeyId, stopId, patch) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    if (!journey) return
    const index = journey.stops.findIndex((item) => item.id === stopId)
    if (index === -1) return
    const stop = journey.stops[index]
    const geometryChanged =
      (patch.lat !== undefined && patch.lat !== stop.lat) ||
      (patch.lon !== undefined && patch.lon !== stop.lon)
    Object.assign(stop, patch)
    if (geometryChanged) clearAdjacentRoutes(journey, index)
    journey.updatedAt = new Date().toISOString()
    touch(next, get().session?.editor)
    set({ atlas: next, dirty: true })
    if (geometryChanged) {
      if (index > 0 && journey.legs[index - 1]) void get().refreshRoute(journeyId, index - 1)
      if (journey.legs[index]) void get().refreshRoute(journeyId, index)
    }
  },

  deleteStop: (journeyId, stopId) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    if (!journey) return
    const index = journey.stops.findIndex((item) => item.id === stopId)
    if (index === -1) return
    journey.stops.splice(index, 1)
    if (index === 0) journey.legs.splice(0, 1)
    else if (index === journey.stops.length) journey.legs.splice(index - 1, 1)
    else {
      journey.legs.splice(index, 1)
      const incoming = journey.legs[index - 1]
      if (incoming) {
        incoming.route = null
        incoming.connection = null
      }
    }
    journey.updatedAt = new Date().toISOString()
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: [...get().history, structuredClone(atlas)].slice(-20),
    })
    if (useUIStore.getState().selectedStopId === stopId) {
      useUIStore.setState({ selectedStopId: null })
      writeUrlSelection(journeyId, null)
    }
  },

  moveStop: (journeyId, stopId, direction) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    if (!journey) return
    const index = journey.stops.findIndex((item) => item.id === stopId)
    const target = index + direction
    if (index === -1 || target < 0 || target >= journey.stops.length) return
    const [stop] = journey.stops.splice(index, 1)
    journey.stops.splice(target, 0, stop)
    clearAllRoutes(journey)
    journey.updatedAt = new Date().toISOString()
    touch(next, get().session?.editor)
    set({
      atlas: next,
      dirty: true,
      history: [...get().history, structuredClone(atlas)].slice(-20),
    })
  },

  updateLeg: (journeyId, index, patch) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    if (!journey) return
    const leg = journey.legs[index]
    if (!leg) return
    const modeChanged = patch.mode !== undefined && patch.mode !== leg.mode
    Object.assign(leg, patch)
    if (modeChanged) {
      leg.route = null
      leg.connection = null
    }
    journey.updatedAt = new Date().toISOString()
    touch(next, get().session?.editor)
    set({ atlas: next, dirty: true })
    if (modeChanged) void get().refreshRoute(journeyId, index)
  },

  setConnection: (journeyId, index, connection) => {
    const atlas = get().atlas
    if (!atlas) return
    const next = structuredClone(atlas)
    const journey = next.journeys.find((item) => item.id === journeyId)
    const leg = journey?.legs[index]
    if (!journey || !leg) return
    leg.connection = connection
    journey.updatedAt = new Date().toISOString()
    touch(next, get().session?.editor)
    set({ atlas: next, dirty: true })
  },

  refreshRoute: async (journeyId, index) => {
    const { atlas, session } = get()
    if (!atlas) return
    const journey = atlas.journeys.find((item) => item.id === journeyId)
    const leg = journey?.legs[index]
    const from = journey?.stops[index]
    const to = journey?.stops[index + 1]
    if (!journey || !leg || !from || !to) return
    const key = `${journeyId}:${index}`
    if (leg.mode === 'plane' || leg.mode === 'ferry') {
      const next = structuredClone(atlas)
      const target = next.journeys.find((item) => item.id === journeyId)?.legs[index]
      if (target) {
        tierRoute(target, from, to)
        set({ atlas: next, dirty: true })
      }
      return
    }
    if (session?.mode !== 'relay' || !session.token || !siteConfig.apiBase) return
    if (leg.route?.points?.length && leg.route.status === 'routed') return
    set({ routePending: { ...get().routePending, [key]: true } })
    try {
      const route = await computeRoute(
        session.token,
        leg.mode,
        { lat: from.lat, lon: from.lon, name: stopName(from, 'en') },
        { lat: to.lat, lon: to.lon, name: stopName(to, 'en') },
      )
      const current = get().atlas
      if (!current) return
      const next = structuredClone(current)
      const targetJourney = next.journeys.find((item) => item.id === journeyId)
      const target = targetJourney?.legs[index]
      const targetFrom = targetJourney?.stops[index]
      const targetTo = targetJourney?.stops[index + 1]
      if (target) {
        target.route = route
        if (targetFrom && targetTo) {
          target.route.distanceKm =
            route.distanceKm ??
            haversineKm([targetFrom.lon, targetFrom.lat], [targetTo.lon, targetTo.lat])
        }
      }
      set({ atlas: next, dirty: true })
    } catch (error) {
      if (error instanceof ApiError && error.status === 401) {
        clearSession()
        set({ session: null, editMode: false, authOpen: true, authError: 'expired' })
      }
    } finally {
      const pending = { ...get().routePending }
      delete pending[key]
      set({ routePending: pending })
    }
  },

  prepareRoutes: async () => {
    const { atlas, session } = get()
    if (!atlas) return null
    const next = structuredClone(atlas)
    let changed = false
    const token = session?.mode === 'relay' ? session.token : undefined
    const canRemote = Boolean(token && siteConfig.apiBase)
    const pending: Record<string, boolean> = {}

    for (const journey of next.journeys) {
      for (let index = 0; index < journey.legs.length; index += 1) {
        const leg = journey.legs[index]
        const from = journey.stops[index]
        const to = journey.stops[index + 1]
        if (!from || !to) continue
        if (leg.mode === 'plane' || leg.mode === 'ferry') {
          if (tierRoute(leg, from, to)) changed = true
          continue
        }
        if (leg.route?.points?.length && leg.route.status === 'routed') {
          if (!leg.route.distanceKm) {
            leg.route.distanceKm =
              Math.round(
                haversineKm([from.lon, from.lat], [to.lon, to.lat]) * 10,
              ) / 10
            changed = true
          }
          continue
        }
        if (!canRemote || !token) continue
        const key = `${journey.id}:${index}`
        pending[key] = true
        set({ routePending: { ...get().routePending, [key]: true } })
        try {
          const route = await computeRoute(
            token,
            leg.mode,
            { lat: from.lat, lon: from.lon, name: stopName(from, 'en') },
            { lat: to.lat, lon: to.lon, name: stopName(to, 'en') },
          )
          leg.route = route
          if (!route.distanceKm) {
            route.distanceKm =
              Math.round(
                haversineKm([from.lon, from.lat], [to.lon, to.lat]) * 10,
              ) / 10
          }
          changed = true
        } catch {
          // Saving still succeeds with an estimated line.
        } finally {
          delete pending[key]
          set({ routePending: { ...get().routePending, [key]: false } })
        }
      }
    }

    if (changed) {
      touch(next, session?.editor)
      set({ atlas: next, dirty: true, routePending: {} })
    } else {
      set({ routePending: {} })
    }
    return next
  },

  undo: () => {
    const history = get().history
    if (!history.length) return
    const previous = history[history.length - 1]
    set({
      atlas: structuredClone(previous),
      dirty: true,
      history: history.slice(0, -1),
    })
    useUIStore.getState().showToast(
      useUIStore.getState().locale === 'zh' ? '已撤销' : 'Undone',
    )
  },
}))

/** Sum of all leg distances for a journey (used by the index and header). */
export function journeyKm(journey: Journey): number {
  let total = 0
  for (let i = 0; i < journey.legs.length; i += 1) {
    const from = journey.stops[i]
    const to = journey.stops[i + 1]
    if (!from || !to) continue
    total += legDistanceKm(journey.legs[i], from, to)
  }
  return total
}

/** Display title for a journey, used in toasts and document titles. */
export function displayJourneyTitle(journey: Journey, locale: Locale): string {
  return journeyTitle(journey, locale)
}
