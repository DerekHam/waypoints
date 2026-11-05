import { useEffect, useState } from 'react'
import { siteConfig } from '@/config'
import { useT } from '@/i18n'
import { useAtlasStore } from '@/store'
import { Spinner, Modal } from './ui'
import { KeyIcon } from './Icons'

export function AuthDialog() {
  const { t } = useT()
  const authOpen = useAtlasStore((state) => state.authOpen)
  const authBusy = useAtlasStore((state) => state.authBusy)
  const authError = useAtlasStore((state) => state.authError)
  const closeAuth = useAtlasStore((state) => state.closeAuth)
  const login = useAtlasStore((state) => state.login)
  const loginLocal = useAtlasStore((state) => state.loginLocal)
  const [key, setKey] = useState('')
  const [showKey, setShowKey] = useState(false)

  useEffect(() => {
    if (authOpen) {
      setKey('')
      setShowKey(false)
    }
  }, [authOpen])

  const errorMessage =
    authError === 'invalid'
      ? t('invalidKey')
      : authError === 'rate'
        ? t('rateLimited')
        : authError === 'expired'
          ? t('sessionExpired')
          : authError === 'network'
            ? t('networkError')
            : authError === 'not_configured'
              ? t('relayMissing')
              : authError === 'save'
                ? t('saveError')
                : null

  const configured = Boolean(siteConfig.apiBase)
  const allowLocal = !configured || authError === 'network' || authError === 'not_configured'

  return (
    <Modal
      open={authOpen}
      title={t('loginTitle')}
      onClose={closeAuth}
      className="auth-modal"
      footer={
        <div className="auth-foot">
          <span className="muted small">{t('noKeyYet', { name: siteConfig.owner })}</span>
        </div>
      }
    >
      <p className="modal-copy">{t('loginBody')}</p>
      <p className="notice">
        {t('publicNotice')} <span className="muted">{t('privateNote')}</span>
      </p>

      <form
        className="auth-form"
        onSubmit={(event) => {
          event.preventDefault()
          if (key.trim()) void login(key.trim())
        }}
      >
        <label className="field">
          <span className="field-label">{t('accessKey')}</span>
          <div className="key-input-wrap">
            <KeyIcon size={16} className="key-icon" />
            <input
              type={showKey ? 'text' : 'password'}
              value={key}
              onChange={(event) => setKey(event.target.value)}
              placeholder={t('accessKeyPlaceholder')}
              autoComplete="current-password"
              spellCheck={false}
              disabled={authBusy}
            />
            <button
              type="button"
              className="key-toggle"
              onClick={() => setShowKey((value) => !value)}
              aria-label={showKey ? t('hideKey') : t('showKey')}
            >
              {showKey ? '•••' : 'Aa'}
            </button>
          </div>
        </label>
        {errorMessage ? <p className="form-error">{errorMessage}</p> : null}
        <button type="submit" className="button button-ink auth-submit" disabled={authBusy || !key.trim()}>
          {authBusy ? <Spinner size={15} /> : <KeyIcon size={16} />}
          {t('unlock')}
        </button>
      </form>

      {allowLocal ? (
        <div className="local-preview">
          <div>
            <strong>{t('localPreview')}</strong>
            <p className="muted small">{t('localPreviewBody')}</p>
          </div>
          <button type="button" className="button button-quiet" onClick={loginLocal}>
            {t('localPreviewButton')}
          </button>
        </div>
      ) : null}
    </Modal>
  )
}
