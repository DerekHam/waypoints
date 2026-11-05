import { useT } from '@/i18n'
import { useAtlasStore } from '@/store'
import { formatTimestamp } from '@/lib/geo'
import { Modal } from './ui'

export function ConflictDialog() {
  const { t, locale } = useT()
  const conflict = useAtlasStore((state) => state.conflict)
  const saveState = useAtlasStore((state) => state.saveState)
  const resolveLoad = useAtlasStore((state) => state.resolveConflictLoad)
  const resolveOverwrite = useAtlasStore((state) => state.resolveConflictOverwrite)
  const download = useAtlasStore((state) => state.downloadConflictCopy)

  const busy = saveState === 'saving'

  return (
    <Modal
      open={Boolean(conflict)}
      title={t('conflictTitle')}
      onClose={() => undefined}
      dismissible={false}
      className="conflict-modal"
      footer={
        <div className="conflict-actions">
          <button type="button" className="button button-quiet" onClick={download}>
            {t('conflictDownload')}
          </button>
          <div className="conflict-actions-right">
            <button type="button" className="button button-quiet" onClick={resolveLoad} disabled={busy}>
              {t('conflictLoad')}
            </button>
            <button
              type="button"
              className="button button-danger"
              onClick={() => void resolveOverwrite()}
              disabled={busy}
            >
              {t('conflictOverwrite')}
            </button>
          </div>
        </div>
      }
    >
      <p className="modal-copy">{t('conflictBody')}</p>
      {conflict ? (
        <dl className="conflict-meta">
          <div>
            <dt>{t('updated', { date: formatTimestamp(conflict.remote.updatedAt, locale) })}</dt>
            <dd>
              {conflict.remote.lastEditedBy
                ? t('editedBy', { name: conflict.remote.lastEditedBy })
                : ''}
            </dd>
          </div>
        </dl>
      ) : null}
      <p className="notice">{t('conflictHint')}</p>
    </Modal>
  )
}

export function DraftPrompt() {
  const { t } = useT()
  const draft = useAtlasStore((state) => state.draftAvailable)
  const restore = useAtlasStore((state) => state.restoreDraft)
  const discard = useAtlasStore((state) => state.discardDraft)
  if (!draft) return null
  return (
    <div className="draft-prompt" role="status">
      <div>
        <strong>{t('restoreDraft')}</strong>
        <p className="muted small">{t('restoreDraftBody')}</p>
      </div>
      <div className="draft-actions">
        <button type="button" className="button button-quiet" onClick={discard}>
          {t('discardDraft')}
        </button>
        <button type="button" className="button button-ink" onClick={restore}>
          {t('restore')}
        </button>
      </div>
      <button
        type="button"
        className="draft-dismiss"
        aria-label={t('close')}
        onClick={() => useAtlasStore.setState({ draftAvailable: null })}
      >
        ×
      </button>
    </div>
  )
}
