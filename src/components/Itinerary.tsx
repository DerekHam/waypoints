import { useEffect, useMemo, useState } from 'react'
import {
  JOURNEY_COLORS,
  TRANSPORT_MODES,
  journeyNote,
  journeySubtitle,
  journeyTitle,
  linkLabel,
  makeId,
  stopName,
  stopNote,
  stopPlace,
  type Journey,
  type Leg,
  type Link,
  type Locale,
  type Stop,
  type TransportMode,
} from '@shared/atlas'
import { useAtlasStore, useUIStore, journeyKm } from '@/store'
import { siteConfig } from '@/config'
import { useT, type MessageKey } from '@/i18n'
import {
  formatDate,
  formatDateRange,
  formatDistance,
  formatDuration,
  formatTimestamp,
  legDistanceKm,
  nightsBetween,
} from '@/lib/geo'
import { JOURNEY_HEX, journeyColor } from '@/lib/colors'
import {
  ArrowDownIcon,
  ArrowUpIcon,
  CheckIcon,
  ExternalLinkIcon,
  ModeIcon,
  PlusIcon,
  TrashIcon,
  TrainIcon,
  UndoIcon,
} from './Icons'
import { SearchBox } from './SearchBox'
import { ConnectionDialog } from './ConnectionDialog'
import { ConfirmDialog, Field, Spinner } from './ui'
import type { PlaceResult } from '@/lib/search'

type T = ReturnType<typeof useT>['t']

const MODE_KEYS: Record<TransportMode, MessageKey> = {
  plane: 'modePlane',
  train: 'modeTrain',
  car: 'modeCar',
  bus: 'modeBus',
  ferry: 'modeFerry',
  bike: 'modeBike',
  walk: 'modeWalk',
}

function modeLabel(mode: TransportMode, t: T): string {
  return t(MODE_KEYS[mode])
}

function secondaryName(stop: Stop, locale: Locale): string {
  const chinese = stop.nameZh?.trim()
  if (locale === 'en' && chinese) return chinese
  if (locale === 'zh' && chinese && stop.name && stop.name !== chinese) return stop.name
  return ''
}

function IconSpinner() {
  return <Spinner size={13} />
}

export function Itinerary() {
  const { t, locale } = useT()
  const atlas = useAtlasStore((state) => state.atlas)
  const status = useAtlasStore((state) => state.status)
  const error = useAtlasStore((state) => state.error)
  const load = useAtlasStore((state) => state.load)
  const session = useAtlasStore((state) => state.session)
  const editMode = useAtlasStore((state) => state.editMode)
  const dirty = useAtlasStore((state) => state.dirty)
  const historyLength = useAtlasStore((state) => state.history.length)
  const saveState = useAtlasStore((state) => state.saveState)
  const saveError = useAtlasStore((state) => state.saveError)
  const routePending = useAtlasStore((state) => state.routePending)
  const save = useAtlasStore((state) => state.save)
  const discardChanges = useAtlasStore((state) => state.discardChanges)
  const undo = useAtlasStore((state) => state.undo)
  const setEditMode = useAtlasStore((state) => state.setEditMode)
  const addStop = useAtlasStore((state) => state.addStop)
  const updateJourney = useAtlasStore((state) => state.updateJourney)
  const updateStop = useAtlasStore((state) => state.updateStop)
  const deleteStop = useAtlasStore((state) => state.deleteStop)
  const updateLeg = useAtlasStore((state) => state.updateLeg)
  const addJourney = useAtlasStore((state) => state.addJourney)

  const selectedJourneyId = useUIStore((state) => state.selectedJourneyId)
  const selectedStopId = useUIStore((state) => state.selectedStopId)
  const selectStop = useUIStore((state) => state.selectStop)

  const [connectionEdit, setConnectionEdit] = useState<{ journeyId: string; legIndex: number } | null>(
    null,
  )
  const [stopToDelete, setStopToDelete] = useState<Stop | null>(null)
  const [discardOpen, setDiscardOpen] = useState(false)

  const journey = useMemo(() => {
    if (!atlas) return null
    return (
      atlas.journeys.find((item) => item.id === selectedJourneyId) ??
      atlas.journeys[0] ??
      null
    )
  }, [atlas, selectedJourneyId])

  const selectedStop = journey?.stops.find((stop) => stop.id === selectedStopId) ?? null
  const lastStop = journey?.stops[journey.stops.length - 1] ?? null
  const bias = useMemo(() => {
    const source = selectedStop ?? lastStop
    return source ? { lat: source.lat, lon: source.lon } : null
  }, [selectedStop?.lat, selectedStop?.lon, lastStop?.lat, lastStop?.lon])

  useEffect(() => {
    if (!selectedStopId) return
    const timer = window.setTimeout(() => {
      const element = document.querySelector<HTMLElement>(
        `[data-stop-id="${CSS.escape(selectedStopId)}"]`,
      )
      element?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }, 80)
    return () => window.clearTimeout(timer)
  }, [selectedStopId])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        if (!editMode || !session) return
        event.preventDefault()
        void save()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editMode, session, save])

  if (status === 'loading' || (status === 'idle' && !atlas)) {
    return (
      <aside className="panel" aria-label={t('itinerary')}>
        <div className="panel-inner">
          <div className="skeleton skeleton-kicker" />
          <div className="skeleton skeleton-title" />
          <div className="skeleton skeleton-line" />
          <div className="skeleton skeleton-line short" />
          <div className="skeleton skeleton-stop" />
          <div className="skeleton skeleton-stop" />
          <div className="skeleton skeleton-stop" />
        </div>
      </aside>
    )
  }

  if (status === 'error' || !atlas) {
    return (
      <aside className="panel" aria-label={t('itinerary')}>
        <div className="panel-inner panel-error">
          <span className="eyebrow">{t('error')}</span>
          <h2>{t('error')}</h2>
          <p className="muted">{error ? t('errorBody') : t('errorBody')}</p>
          <button type="button" className="button button-ink" onClick={() => void load()}>
            {t('retry')}
          </button>
        </div>
      </aside>
    )
  }

  if (!journey) {
    return (
      <aside className="panel" aria-label={t('itinerary')}>
        <div className="panel-inner panel-error">
          <span className="eyebrow">{t('journeys')}</span>
          <h2>{t('noJourneys')}</h2>
          <p className="muted">{t('noJourneysBody')}</p>
          {session && editMode ? (
            <button type="button" className="button button-ink" onClick={() => addJourney()}>
              <PlusIcon size={16} /> {t('newJourney')}
            </button>
          ) : null}
        </div>
      </aside>
    )
  }

  const journeyIndex = atlas.journeys.indexOf(journey) + 1
  const firstStop = journey.stops[0]
  const finalStop = journey.stops[journey.stops.length - 1]
  const dateRange = formatDateRange(firstStop?.arrive, finalStop?.depart, locale)
  const distance = journeyKm(journey)
  const pendingCount = Object.values(routePending).filter(Boolean).length
  const connectionLeg =
    connectionEdit && connectionEdit.journeyId === journey.id
      ? journey.legs[connectionEdit.legIndex]
      : null
  const connectionFrom =
    connectionEdit && connectionEdit.journeyId === journey.id
      ? journey.stops[connectionEdit.legIndex]
      : null
  const connectionTo =
    connectionEdit && connectionEdit.journeyId === journey.id
      ? journey.stops[connectionEdit.legIndex + 1]
      : null

  const handlePlace = (place: PlaceResult) => {
    const stop: Stop = {
      id: makeId('stop'),
      name: place.name,
      nameZh: place.nameZh,
      region: place.region,
      regionZh: place.regionZh,
      country: place.country,
      countryZh: place.countryZh,
      lat: place.lat,
      lon: place.lon,
      note: '',
      noteZh: '',
      links: [],
    }
    addStop(journey.id, stop)
  }

  return (
    <aside className="panel" aria-label={t('itinerary')}>
      <div className="panel-scroll">
        <header className="journey-head">
          <div className="journey-kicker">
            <span className="color-mark" style={{ background: journeyColor(journey.color) }} />
            <span className="eyebrow">
              {t('journey')} {String(journeyIndex).padStart(2, '0')}
            </span>
            <span className="kicker-rule" />
            {journey.id === 'jiangnan-shu-roads' ? (
              <span className="eyebrow muted">{t('sampleJourney')}</span>
            ) : null}
          </div>

          {editMode ? (
            <div className="journey-form">
              <div className="field-row">
                <Field label={t('journeyTitle')}>
                  <input
                    value={journey.title}
                    onChange={(event) => updateJourney(journey.id, { title: event.target.value })}
                  />
                </Field>
                <Field label={t('journeyTitleZh')}>
                  <input
                    value={journey.titleZh ?? ''}
                    onChange={(event) =>
                      updateJourney(journey.id, { titleZh: event.target.value })
                    }
                    lang="zh-CN"
                  />
                </Field>
              </div>
              <div className="field-row">
                <Field label={t('subtitle')}>
                  <input
                    value={journey.subtitle ?? ''}
                    onChange={(event) =>
                      updateJourney(journey.id, { subtitle: event.target.value })
                    }
                  />
                </Field>
                <Field label={t('subtitleZh')}>
                  <input
                    value={journey.subtitleZh ?? ''}
                    onChange={(event) =>
                      updateJourney(journey.id, { subtitleZh: event.target.value })
                    }
                    lang="zh-CN"
                  />
                </Field>
              </div>
              <div className="field-row">
                <Field label={t('description')}>
                  <textarea
                    rows={3}
                    value={journey.note ?? ''}
                    onChange={(event) => updateJourney(journey.id, { note: event.target.value })}
                  />
                </Field>
                <Field label={t('descriptionZh')}>
                  <textarea
                    rows={3}
                    value={journey.noteZh ?? ''}
                    onChange={(event) =>
                      updateJourney(journey.id, { noteZh: event.target.value })
                    }
                    lang="zh-CN"
                  />
                </Field>
              </div>
              <div className="color-row">
                <span className="field-label">{t('color')}</span>
                <div className="color-swatches">
                  {JOURNEY_COLORS.map((color) => (
                    <button
                      key={color}
                      type="button"
                      className={`color-swatch ${journey.color === color ? 'is-selected' : ''}`}
                      style={{ background: JOURNEY_HEX[color] }}
                      onClick={() => updateJourney(journey.id, { color })}
                      aria-label={`${t('color')} ${color}`}
                      aria-pressed={journey.color === color}
                      title={color}
                    />
                  ))}
                </div>
              </div>
            </div>
          ) : (
            <>
              <h1 className="journey-title">{journeyTitle(journey, locale)}</h1>
              {journeySubtitle(journey, locale) ? (
                <p className="journey-subtitle">{journeySubtitle(journey, locale)}</p>
              ) : null}
              <div className="journey-meta">
                {dateRange ? <span>{dateRange}</span> : null}
                <span>
                  {journey.stops.length === 1 ? t('stopOne') : t('stopCount', { count: journey.stops.length })}
                </span>
                {distance > 0 ? <span>{formatDistance(distance, locale)}</span> : null}
              </div>
              {journeyNote(journey, locale) ? (
                <p className="journey-note">{journeyNote(journey, locale)}</p>
              ) : null}
            </>
          )}
        </header>

        {editMode ? (
          <section className="add-place">
            <div className="add-place-head">
              <span className="eyebrow">{t('addPlace')}</span>
              <span className="muted small">{t('searchHint')}</span>
            </div>
            <SearchBox locale={locale} bias={bias} onSelect={handlePlace} />
            <p className="public-hint">
              {t('publicNotice')} <span>{t('privateNote')}</span>
            </p>
          </section>
        ) : null}

        {journey.stops.length === 0 ? (
          <div className="journey-empty">
            <span className="eyebrow">{t('stops')}</span>
            <p>{t('journeyEmpty')}</p>
            {editMode ? <p className="muted small">{t('addStopFirst')}</p> : null}
          </div>
        ) : (
          <ol className="stop-list">
            {journey.stops.map((stop, index) => (
              <li
                key={stop.id}
                className={`stop-item ${selectedStopId === stop.id ? 'is-selected' : ''}`}
                data-stop-id={stop.id}
              >
                <StopRow
                  journey={journey}
                  stop={stop}
                  index={index}
                  locale={locale}
                  editMode={editMode}
                  selected={selectedStopId === stop.id}
                  onSelect={() => selectStop(journey.id, stop.id)}
                  onDelete={() => setStopToDelete(stop)}
                />
                {selectedStopId === stop.id && editMode ? (
                  <StopEditor
                    journey={journey}
                    stop={stop}
                    updateStop={updateStop}
                    onDelete={() => setStopToDelete(stop)}
                  />
                ) : null}
                {index < journey.legs.length ? (
                  <LegRow
                    from={stop}
                    to={journey.stops[index + 1]}
                    leg={journey.legs[index]}
                    locale={locale}
                    editMode={editMode}
                    pending={Boolean(routePending[`${journey.id}:${index}`])}
                    onMode={(mode) => updateLeg(journey.id, index, { mode })}
                    onCheck={() => setConnectionEdit({ journeyId: journey.id, legIndex: index })}
                  />
                ) : null}
              </li>
            ))}
          </ol>
        )}

        <footer className="panel-attribution">
          <div className="attribution-meta">
            <span>{t('updated', { date: formatTimestamp(atlas.updatedAt, locale) })}</span>
            {atlas.lastEditedBy ? (
              <span>{t('editedBy', { name: atlas.lastEditedBy })}</span>
            ) : null}
          </div>
          <div className="attribution-links">
            <a href="https://openfreemap.org" target="_blank" rel="noopener noreferrer">
              OpenFreeMap
            </a>
            <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener noreferrer">
              OpenMapTiles
            </a>
            <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener noreferrer">
              OpenStreetMap
            </a>
            <a href="https://mapterhorn.com/attribution" target="_blank" rel="noopener noreferrer">
              Mapterhorn
            </a>
            <a href="https://project-osrm.org/" target="_blank" rel="noopener noreferrer">
              OSRM
            </a>
            <a
              href="https://github.com/geofabrik/OpenRailRouting"
              target="_blank"
              rel="noopener noreferrer"
            >
              OpenRailRouting
            </a>
            <a href="https://transitous.org/" target="_blank" rel="noopener noreferrer">
              Transitous
            </a>
            <a
              href={siteConfig.repoUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="source-link"
            >
              {t('viewSource')} <ExternalLinkIcon size={11} />
            </a>
          </div>
          <p className="attribution-note">{t('attributionNote')}</p>
        </footer>
      </div>

      {session && editMode ? (
        <div className="save-bar">
          <div className="save-status">
            {saveState === 'preparing' || pendingCount > 0 ? (
              <span className="save-preparing">
                <IconSpinner /> {t('preparingRoutes')}
              </span>
            ) : saveState === 'saving' ? (
              <span className="save-preparing">
                <IconSpinner /> {t('saving')}
              </span>
            ) : saveState === 'error' ? (
              <span className="save-error">{t('saveError')}</span>
            ) : dirty ? (
              <span>{t('unsaved')}</span>
            ) : (
              <span className="save-ok">
                <CheckIcon size={14} /> {t('saved')}
              </span>
            )}
            {session.mode === 'local' ? (
              <span className="local-badge">{t('localPreview')}</span>
            ) : null}
            {saveError && saveState === 'error' ? (
              <span className="save-error small">{saveError}</span>
            ) : null}
          </div>
          <div className="save-actions">
            {historyLength > 0 ? (
              <button type="button" className="icon-button" onClick={undo} title={t('undo')}>
                <UndoIcon size={17} />
              </button>
            ) : null}
            <button
              type="button"
              className="button button-quiet small"
              onClick={() => setDiscardOpen(true)}
              disabled={!dirty}
            >
              {t('discard')}
            </button>
            <button
              type="button"
              className="button button-quiet small"
              onClick={() => setEditMode(false)}
            >
              {t('preview')}
            </button>
            <button
              type="button"
              className="button button-ink small"
              onClick={() => void save()}
              disabled={!dirty || saveState === 'saving' || saveState === 'preparing'}
            >
              {saveState === 'saving' || saveState === 'preparing' ? (
                <IconSpinner />
              ) : null}
              {t('save')}
            </button>
          </div>
        </div>
      ) : null}

      {connectionLeg && connectionFrom && connectionTo ? (
        <ConnectionDialog
          open
          onClose={() => setConnectionEdit(null)}
          journeyId={journey.id}
          legIndex={connectionEdit?.legIndex ?? 0}
          from={connectionFrom}
          to={connectionTo}
          current={connectionLeg.connection}
        />
      ) : null}

      <ConfirmDialog
        open={Boolean(stopToDelete)}
        title={t('delete')}
        message={
          stopToDelete
            ? t('deleteStopConfirm', { name: stopName(stopToDelete, locale) })
            : ''
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (stopToDelete) deleteStop(journey.id, stopToDelete.id)
        }}
        onClose={() => setStopToDelete(null)}
      />

      <ConfirmDialog
        open={discardOpen}
        title={t('discardChanges')}
        message={t('discardConfirmBody')}
        confirmLabel={t('discard')}
        cancelLabel={t('cancel')}
        onConfirm={discardChanges}
        onClose={() => setDiscardOpen(false)}
      />
    </aside>
  )
}

function StopRow({
  journey,
  stop,
  index,
  locale,
  editMode,
  selected,
  onSelect,
  onDelete,
}: {
  journey: Journey
  stop: Stop
  index: number
  locale: Locale
  editMode: boolean
  selected: boolean
  onSelect: () => void
  onDelete: () => void
}) {
  const { t } = useT()
  const moveStop = useAtlasStore((state) => state.moveStop)
  const nights = nightsBetween(stop.arrive, stop.depart)
  const dates = formatDateRange(stop.arrive, stop.depart, locale)
  const place = stopPlace(stop, locale)
  const alternate = secondaryName(stop, locale)
  const note = stopNote(stop, locale)

  return (
    <div className="stop-row">
      <span className="stop-number" style={{ background: journeyColor(journey.color) }}>
        {index + 1}
      </span>
      <div className="stop-body">
        <button type="button" className="stop-main" onClick={onSelect} aria-pressed={selected}>
          <span className="stop-name-line">
            <span className="stop-name">{stopName(stop, locale)}</span>
            {alternate ? <span className="stop-alt">{alternate}</span> : null}
          </span>
          <span className="stop-meta">
            {place ? <span>{place}</span> : null}
            {dates ? <span>{dates}</span> : null}
            {nights ? (
              <span>{nights === 1 ? t('nightOne') : t('nightCount', { count: nights })}</span>
            ) : null}
          </span>
          {!editMode && note ? <span className="stop-note">{note}</span> : null}
        </button>
        {!editMode && stop.links.length > 0 ? (
          <div className="stop-links">
            {stop.links.map((link, linkIndex) => (
              <a
                key={`${link.url}-${linkIndex}`}
                href={link.url}
                target="_blank"
                rel="noopener noreferrer"
                className="stop-link"
              >
                {linkLabel(link, locale)}
                <ExternalLinkIcon size={11} />
              </a>
            ))}
          </div>
        ) : null}
        {editMode ? (
          <div className="stop-actions">
            <button
              type="button"
              className="icon-button small"
              onClick={() => moveStop(journey.id, stop.id, -1)}
              disabled={index === 0}
              aria-label={t('moveUp')}
              title={t('moveUp')}
            >
              <ArrowUpIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-button small"
              onClick={() => moveStop(journey.id, stop.id, 1)}
              disabled={index === journey.stops.length - 1}
              aria-label={t('moveDown')}
              title={t('moveDown')}
            >
              <ArrowDownIcon size={15} />
            </button>
            <button
              type="button"
              className="icon-button small danger"
              onClick={onDelete}
              aria-label={t('delete')}
              title={t('delete')}
            >
              <TrashIcon size={15} />
            </button>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function StopEditor({
  journey,
  stop,
  updateStop,
  onDelete,
}: {
  journey: Journey
  stop: Stop
  updateStop: (journeyId: string, stopId: string, patch: Partial<Stop>) => void
  onDelete: () => void
}) {
  const { t } = useT()
  const set = (patch: Partial<Stop>) => updateStop(journey.id, stop.id, patch)
  const setLink = (index: number, patch: Partial<Link>) => {
    set({ links: stop.links.map((link, linkIndex) => (linkIndex === index ? { ...link, ...patch } : link)) })
  }
  return (
    <div className="stop-editor">
      <div className="field-row">
        <Field label={t('stopName')}>
          <input value={stop.name} onChange={(event) => set({ name: event.target.value })} />
        </Field>
        <Field label={t('stopNameZh')}>
          <input
            value={stop.nameZh ?? ''}
            onChange={(event) => set({ nameZh: event.target.value })}
            lang="zh-CN"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t('region')}>
          <input value={stop.region ?? ''} onChange={(event) => set({ region: event.target.value })} />
        </Field>
        <Field label={t('regionZh')}>
          <input
            value={stop.regionZh ?? ''}
            onChange={(event) => set({ regionZh: event.target.value })}
            lang="zh-CN"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t('country')}>
          <input
            value={stop.country ?? ''}
            onChange={(event) => set({ country: event.target.value })}
          />
        </Field>
        <Field label={t('countryZh')}>
          <input
            value={stop.countryZh ?? ''}
            onChange={(event) => set({ countryZh: event.target.value })}
            lang="zh-CN"
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t('arrival')}>
          <input
            type="date"
            value={stop.arrive ?? ''}
            onChange={(event) => set({ arrive: event.target.value || undefined })}
          />
        </Field>
        <Field label={t('departure')}>
          <input
            type="date"
            value={stop.depart ?? ''}
            onChange={(event) => set({ depart: event.target.value || undefined })}
          />
        </Field>
      </div>
      <div className="field-row">
        <Field label={t('note')}>
          <textarea
            rows={3}
            value={stop.note ?? ''}
            onChange={(event) => set({ note: event.target.value })}
          />
        </Field>
        <Field label={t('noteZh')}>
          <textarea
            rows={3}
            lang="zh-CN"
            value={stop.noteZh ?? ''}
            onChange={(event) => set({ noteZh: event.target.value })}
          />
        </Field>
      </div>

      <div className="link-editor">
        <div className="link-editor-head">
          <span className="field-label">{t('links')}</span>
          <button
            type="button"
            className="text-button"
            onClick={() => set({ links: [...stop.links, { label: '', labelZh: '', url: '' }] })}
          >
            <PlusIcon size={13} /> {t('addLink')}
          </button>
        </div>
        {stop.links.map((link, index) => (
          <div className="link-row" key={`${link.url}-${index}`}>
            <input
              value={link.label ?? ''}
              onChange={(event) => setLink(index, { label: event.target.value })}
              placeholder={t('linkLabel')}
              aria-label={t('linkLabel')}
            />
            <input
              value={link.labelZh ?? ''}
              onChange={(event) => setLink(index, { labelZh: event.target.value })}
              placeholder={t('linkLabelZh')}
              lang="zh-CN"
              aria-label={t('linkLabelZh')}
            />
            <input
              value={link.url}
              onChange={(event) => setLink(index, { url: event.target.value })}
              onBlur={(event) => {
                const value = event.target.value.trim()
                if (value && !/^https?:\/\//i.test(value)) setLink(index, { url: `https://${value}` })
              }}
              placeholder={t('linkUrl')}
              aria-label={t('linkUrl')}
              inputMode="url"
            />
            <button
              type="button"
              className="icon-button small danger"
              onClick={() => set({ links: stop.links.filter((_, linkIndex) => linkIndex !== index) })}
              aria-label={t('removeLink')}
              title={t('removeLink')}
            >
              <TrashIcon size={14} />
            </button>
          </div>
        ))}
      </div>

      <div className="stop-editor-foot">
        <span className="coordinates">
          {stop.lat.toFixed(4)}, {stop.lon.toFixed(4)}
        </span>
        <button type="button" className="text-button danger" onClick={onDelete}>
          <TrashIcon size={14} /> {t('delete')}
        </button>
      </div>
    </div>
  )
}

function LegRow({
  from,
  to,
  leg,
  locale,
  editMode,
  pending,
  onMode,
  onCheck,
}: {
  from: Stop
  to: Stop
  leg: Leg
  locale: Locale
  editMode: boolean
  pending: boolean
  onMode: (mode: TransportMode) => void
  onCheck: () => void
}) {
  const { t } = useT()
  const distance = legDistanceKm(leg, from, to)
  const estimated =
    leg.mode !== 'plane' &&
    (!leg.route || leg.route.status !== 'routed' || !leg.route.points?.length)
  const midpoint = {
    lat: (from.lat + to.lat) / 2,
    lon: (from.lon + to.lon) / 2,
  }
  const railMapUrl = `https://www.openrailwaymap.org/?lat=${midpoint.lat.toFixed(3)}&lon=${midpoint.lon.toFixed(3)}&zoom=7`

  return (
    <div className="leg-row">
      <span className="leg-spine" aria-hidden="true" />
      <span className="leg-icon" aria-hidden="true">
        <ModeIcon mode={leg.mode} size={14} />
      </span>
      <div className="leg-body">
        {editMode ? (
          <div className="mode-selector" role="group" aria-label={t('transport')}>
            {TRANSPORT_MODES.map((mode) => (
              <button
                key={mode}
                type="button"
                className={`mode-button ${leg.mode === mode ? 'is-active' : ''}`}
                onClick={() => onMode(mode)}
                aria-pressed={leg.mode === mode}
                title={modeLabel(mode, t)}
                aria-label={modeLabel(mode, t)}
              >
                <ModeIcon mode={mode} size={15} />
              </button>
            ))}
          </div>
        ) : null}
        <div className="leg-summary">
          <span className="leg-mode">{modeLabel(leg.mode, t)}</span>
          <span className="leg-distance">{formatDistance(distance, locale)}</span>
          {pending ? (
            <span className="leg-status">
              <IconSpinner /> {t('routePending')}
            </span>
          ) : estimated ? (
            <span className="leg-status muted">{t('routeEstimated')}</span>
          ) : null}
        </div>

        {leg.route?.fromStation ? (
          <p className="leg-stations">
            {leg.route.fromStation}
            <span aria-hidden="true"> → </span>
            {leg.route.toStation}
          </p>
        ) : null}

        {leg.connection ? (
          <button
            type="button"
            className={`leg-connection ${editMode ? 'is-editable' : ''}`}
            onClick={editMode ? onCheck : undefined}
            disabled={!editMode}
          >
            <TrainIcon size={13} />
            <span className="leg-connection-main">
              <span>{leg.connection.summary}</span>
              <span className="muted small">
                {leg.connection.depart}–{leg.connection.arrive} ·{' '}
                {leg.connection.transfers === 0
                  ? t('direct')
                  : `${leg.connection.transfers} ${t('transfers')}`}
                {leg.connection.durationMinutes
                  ? ` · ${formatDuration(leg.connection.durationMinutes, locale)}`
                  : ''}
              </span>
            </span>
            <span className="leg-connection-checked muted small">
              {t('checkedOn', {
                date: formatDate(leg.connection.checkedAt.slice(0, 10), locale),
              })}
            </span>
          </button>
        ) : null}

        {editMode && leg.mode === 'train' ? (
          <div className="leg-edit-actions">
            <button type="button" className="text-button" onClick={onCheck}>
              <TrainIcon size={13} />
              {leg.connection ? t('exampleConnection') : t('checkConnections')}
            </button>
          </div>
        ) : null}

        {leg.mode === 'train' ? (
          <a
            className="leg-map-link"
            href={railMapUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            {t('openInMaps')} <ExternalLinkIcon size={11} />
          </a>
        ) : null}
      </div>
    </div>
  )
}
