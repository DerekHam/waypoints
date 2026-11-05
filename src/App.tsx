import { useEffect } from 'react'
import { journeyTitle } from '@shared/atlas'
import { translate, useT } from '@/i18n'
import { useAtlasStore, useUIStore } from '@/store'
import { saveDraft } from '@/lib/draft'
import { Globe } from '@/components/Globe'
import { Topbar } from '@/components/Topbar'
import { Itinerary } from '@/components/Itinerary'
import { JourneyIndex } from '@/components/JourneyIndex'
import { AuthDialog } from '@/components/AuthDialog'
import { ConflictDialog, DraftPrompt } from '@/components/ConflictDialog'
import { Toast } from '@/components/ui'

export default function App() {
  const { locale } = useT()
  const load = useAtlasStore((state) => state.load)
  const atlas = useAtlasStore((state) => state.atlas)
  const dirty = useAtlasStore((state) => state.dirty)
  const session = useAtlasStore((state) => state.session)
  const baseSha = useAtlasStore((state) => state.baseSha)
  const conflict = useAtlasStore((state) => state.conflict)
  const selectedJourneyId = useUIStore((state) => state.selectedJourneyId)
  const panelCollapsed = useUIStore((state) => state.panelCollapsed)
  const toast = useUIStore((state) => state.toast)
  const clearToast = useUIStore((state) => state.clearToast)

  const journal = atlas?.journeys.find((journey) => journey.id === selectedJourneyId) ?? atlas?.journeys[0]

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const lang = locale === 'zh' ? 'zh-CN' : 'en'
    document.documentElement.lang = lang
    document.documentElement.dataset.locale = locale
  }, [locale])

  useEffect(() => {
    document.title = journal
      ? `${journeyTitle(journal, locale)} — ${translate(locale, 'appName')}`
      : `${translate(locale, 'appName')} — ${translate(locale, 'appSubtitle')}`
  }, [journal?.id, journal?.title, journal?.titleZh, locale])

  useEffect(() => {
    if (!atlas || !dirty || !session) return
    const timer = window.setTimeout(() => {
      saveDraft({
        atlas,
        baseSha,
        savedAt: new Date().toISOString(),
        sessionMode: session.mode,
      })
    }, 900)
    return () => window.clearTimeout(timer)
  }, [atlas, dirty, session, baseSha])

  useEffect(() => {
    const handler = (event: BeforeUnloadEvent) => {
      if (!dirty) return
      if (atlas && session) {
        saveDraft({
          atlas,
          baseSha,
          savedAt: new Date().toISOString(),
          sessionMode: session.mode,
        })
      }
      event.preventDefault()
      event.returnValue = ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [dirty, atlas, baseSha, session])

  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(clearToast, 6_000)
    return () => window.clearTimeout(timer)
  }, [toast?.id, clearToast])

  return (
    <div className={`app ${panelCollapsed ? 'is-panel-collapsed' : ''}`}>
      <div className="paper-texture" aria-hidden="true" />
      <div className="page-frame" aria-hidden="true" />
      <Globe />
      <Topbar />
      <Itinerary />
      <JourneyIndex />
      <AuthDialog />
      <ConflictDialog />
      {!conflict ? <DraftPrompt /> : null}
      <Toast />
    </div>
  )
}
