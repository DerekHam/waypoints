import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { journeySubtitle, journeyTitle, type Journey } from '@shared/atlas'
import { useT } from '@/i18n'
import { useAtlasStore, useUIStore, journeyKm } from '@/store'
import { formatDateRange, formatDistance } from '@/lib/geo'
import { journeyColor } from '@/lib/colors'
import { CloseIcon, DuplicateIcon, EyeIcon, EyeOffIcon, PlusIcon } from './Icons'
import { ConfirmDialog } from './ui'

export function JourneyIndex() {
  const { t, locale } = useT()
  const open = useUIStore((state) => state.indexOpen)
  const setOpen = useUIStore((state) => state.setIndexOpen)
  const showAll = useUIStore((state) => state.showAll)
  const toggleShowAll = useUIStore((state) => state.toggleShowAll)
  const selectJourney = useUIStore((state) => state.selectJourney)
  const selectedJourneyId = useUIStore((state) => state.selectedJourneyId)
  const atlas = useAtlasStore((state) => state.atlas)
  const session = useAtlasStore((state) => state.session)
  const editMode = useAtlasStore((state) => state.editMode)
  const addJourney = useAtlasStore((state) => state.addJourney)
  const duplicateJourney = useAtlasStore((state) => state.duplicateJourney)
  const deleteJourney = useAtlasStore((state) => state.deleteJourney)
  const [journeyToDelete, setJourneyToDelete] = useState<Journey | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    const timer = window.setTimeout(() => closeRef.current?.focus(), 40)
    return () => {
      document.removeEventListener('keydown', onKey)
      window.clearTimeout(timer)
    }
  }, [open, setOpen])

  if (!open) return null

  const journeys = atlas?.journeys ?? []
  const activeId = selectedJourneyId ?? journeys[0]?.id ?? null

  return (
    <>
      <div className="drawer-scrim" onMouseDown={() => setOpen(false)} />
      <aside className="index-drawer" role="dialog" aria-modal="true" aria-label={t('journeys')}>
        <header className="drawer-head">
          <div>
            <span className="eyebrow">{t('appName')}</span>
            <h2>{t('journeys')}</h2>
          </div>
          <button
            ref={closeRef}
            type="button"
            className="icon-button"
            onClick={() => setOpen(false)}
            aria-label={t('close')}
          >
            <CloseIcon size={18} />
          </button>
        </header>

        <button
          type="button"
          className="show-all-toggle"
          role="switch"
          aria-checked={showAll}
          onClick={toggleShowAll}
        >
          <span className="show-all-icon">
            {showAll ? <EyeIcon size={17} /> : <EyeOffIcon size={17} />}
          </span>
          <span className="show-all-copy">
            <strong>{t('showAll')}</strong>
            <small>{t('showAllHint')}</small>
          </span>
          <span className={`switch ${showAll ? 'is-on' : ''}`} aria-hidden="true">
            <span />
          </span>
        </button>

        <div className="journey-cards">
          {journeys.length === 0 ? (
            <div className="index-empty">
              <strong>{t('noJourneys')}</strong>
              <p>{t('noJourneysBody')}</p>
            </div>
          ) : (
            journeys.map((journey, index) => {
              const isActive = journey.id === activeId
              const first = journey.stops[0]
              const last = journey.stops[journey.stops.length - 1]
              const dates = formatDateRange(first?.arrive, last?.depart, locale)
              const distance = journeyKm(journey)
              return (
                <article
                  key={journey.id}
                  className={`journey-card ${isActive ? 'is-active' : ''}`}
                  style={{ '--journey-color': journeyColor(journey.color) } as CSSProperties}
                >
                  <button
                    type="button"
                    className="journey-card-main"
                    onClick={() => selectJourney(journey.id)}
                    aria-pressed={isActive}
                  >
                    <span className="journey-card-top">
                      <span className="journey-index">{String(index + 1).padStart(2, '0')}</span>
                      <span className="journey-card-color" />
                      {isActive ? <span className="active-chip">{t('activeJourney')}</span> : null}
                    </span>
                    <span className="journey-card-title">{journeyTitle(journey, locale)}</span>
                    {journeySubtitle(journey, locale) ? (
                      <span className="journey-card-subtitle">
                        {journeySubtitle(journey, locale)}
                      </span>
                    ) : null}
                    <span className="journey-card-meta">
                      {dates ? <span>{dates}</span> : null}
                      <span>
                        {journey.stops.length === 1
                          ? t('stopOne')
                          : t('stopCount', { count: journey.stops.length })}
                      </span>
                      {distance > 0 ? <span>{formatDistance(distance, locale)}</span> : null}
                    </span>
                  </button>
                  {session && editMode ? (
                    <div className="journey-card-actions">
                      <button
                        type="button"
                        className="text-button"
                        onClick={() => duplicateJourney(journey.id)}
                      >
                        <DuplicateIcon size={13} /> {t('duplicateJourney')}
                      </button>
                      <button
                        type="button"
                        className="text-button danger"
                        onClick={() => setJourneyToDelete(journey)}
                      >
                        {t('deleteJourney')}
                      </button>
                    </div>
                  ) : null}
                </article>
              )
            })
          )}
        </div>

        {session ? (
          <button
            type="button"
            className="button button-ink add-journey"
            onClick={() => {
              addJourney()
              setOpen(false)
            }}
          >
            <PlusIcon size={16} /> {t('newJourney')}
          </button>
        ) : null}

        <footer className="drawer-foot">
          <p>{t('publicNotice')}</p>
        </footer>
      </aside>

      <ConfirmDialog
        open={Boolean(journeyToDelete)}
        title={t('deleteJourney')}
        message={
          journeyToDelete
            ? t('deleteJourneyConfirm', { name: journeyTitle(journeyToDelete, locale) })
            : ''
        }
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        onConfirm={() => {
          if (journeyToDelete) deleteJourney(journeyToDelete.id)
        }}
        onClose={() => setJourneyToDelete(null)}
      />
    </>
  )
}
