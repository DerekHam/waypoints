import { useT } from '@/i18n'
import { useAtlasStore, useUIStore } from '@/store'
import {
  BookIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  EyeIcon,
  KeyIcon,
  LockIcon,
  PencilIcon,
} from './Icons'

export function Topbar() {
  const { t, locale } = useT()
  const atlas = useAtlasStore((state) => state.atlas)
  const session = useAtlasStore((state) => state.session)
  const editMode = useAtlasStore((state) => state.editMode)
  const dirty = useAtlasStore((state) => state.dirty)
  const openAuth = useAtlasStore((state) => state.openAuth)
  const setEditMode = useAtlasStore((state) => state.setEditMode)
  const logout = useAtlasStore((state) => state.logout)
  const indexOpen = useUIStore((state) => state.indexOpen)
  const setIndexOpen = useUIStore((state) => state.setIndexOpen)
  const panelCollapsed = useUIStore((state) => state.panelCollapsed)
  const togglePanel = useUIStore((state) => state.togglePanel)
  const setLocale = useUIStore((state) => state.setLocale)

  const journeyCount = atlas?.journeys.length ?? 0
  const placeCount = atlas?.journeys.reduce((total, journey) => total + journey.stops.length, 0) ?? 0

  return (
    <header className="topbar">
      <div className="site-mark">
        <span className="site-kicker">{t('appKicker')}</span>
        <div className="site-title-line">
          <span className="site-title">{t('appName')}</span>
          <span className="site-rule" />
          <span className="site-count">
            {journeyCount === 1 ? t('journeyOne') : t('journeyCount', { count: journeyCount })}
            <span className="dot">·</span>
            {placeCount === 1 ? t('placeOne') : t('placeCount', { count: placeCount })}
          </span>
        </div>
        <p className="site-subtitle">{t('appSubtitle')}</p>
      </div>

      <div className="top-actions">
        <button
          type="button"
          className="button button-quiet top-button lang-button"
          onClick={() => setLocale(locale === 'zh' ? 'en' : 'zh')}
          title={t('language')}
          aria-label={t('language')}
        >
          {locale === 'zh' ? 'EN' : '中文'}
        </button>

        <button
          type="button"
          className={`button button-quiet top-button ${indexOpen ? 'is-active' : ''}`}
          onClick={() => setIndexOpen(!indexOpen)}
          aria-expanded={indexOpen}
          aria-label={t('index')}
        >
          <BookIcon size={16} />
          <span className="button-label">{t('index')}</span>
        </button>

        <button
          type="button"
          className="icon-button panel-toggle"
          onClick={togglePanel}
          aria-label={t('itinerary')}
          title={t('itinerary')}
        >
          {panelCollapsed ? <ChevronRightIcon size={18} /> : <ChevronLeftIcon size={18} />}
        </button>

        {session ? (
          <>
            {editMode ? (
              <button
                type="button"
                className="button button-quiet top-button"
                onClick={() => setEditMode(false)}
                aria-label={t('preview')}
              >
                <EyeIcon size={16} />
                <span className="button-label">{t('preview')}</span>
              </button>
            ) : (
              <button
                type="button"
                className="button button-ink top-button"
                onClick={() => setEditMode(true)}
                aria-label={t('edit')}
              >
                <PencilIcon size={15} />
                <span className="button-label">{t('edit')}</span>
                {dirty ? <span className="dirty-dot" /> : null}
              </button>
            )}
            <button
              type="button"
              className="icon-button"
              onClick={logout}
              title={t('signedInAs', { name: session.editor })}
              aria-label={t('lock')}
            >
              <LockIcon size={17} />
            </button>
            {session.mode === 'local' ? <span className="local-chip">{t('localPreview')}</span> : null}
          </>
        ) : (
          <button
            type="button"
            className="button button-ink top-button"
            onClick={openAuth}
            aria-label={t('edit')}
          >
            <KeyIcon size={16} />
            <span className="button-label">{t('edit')}</span>
          </button>
        )}
      </div>
    </header>
  )
}
