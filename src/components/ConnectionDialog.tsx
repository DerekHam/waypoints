import { useEffect, useState } from 'react'
import type { RailConnection, Stop } from '@shared/atlas'
import { siteConfig } from '@/config'
import { useT } from '@/i18n'
import { useAtlasStore } from '@/store'
import { ApiError, findRailConnections, type ConnectionOption } from '@/lib/api'
import { formatDate, formatDuration, timezoneFor } from '@/lib/geo'
import { CalendarIcon, TrainIcon } from './Icons'
import { Modal, Spinner } from './ui'

type ConnectionDialogProps = {
  open: boolean
  onClose: () => void
  journeyId: string
  legIndex: number
  from: Stop
  to: Stop
  current: RailConnection | null | undefined
}

export function ConnectionDialog({
  open,
  onClose,
  journeyId,
  legIndex,
  from,
  to,
  current,
}: ConnectionDialogProps) {
  const { t, locale } = useT()
  const session = useAtlasStore((state) => state.session)
  const setConnection = useAtlasStore((state) => state.setConnection)
  const [date, setDate] = useState('')
  const [time, setTime] = useState('09:00')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [options, setOptions] = useState<ConnectionOption[] | null>(null)

  const timezone = timezoneFor(from.lat, from.lon)
  const arriveTimezone = timezoneFor(to.lat, to.lon)

  useEffect(() => {
    if (!open) return
    setDate(current?.serviceDate ?? to.arrive ?? from.depart ?? new Date().toISOString().slice(0, 10))
    setTime(current?.depart ?? '09:00')
    setError(null)
    setOptions(null)
    setLoading(false)
  }, [open, current, from.depart, to.arrive])

  const search = async () => {
    setError(null)
    setOptions(null)
    if (!session || session.mode !== 'relay' || !session.token || !siteConfig.apiBase) {
      setError('relay')
      return
    }
    setLoading(true)
    try {
      const result = await findRailConnections(
        session.token,
        { lat: from.lat, lon: from.lon, name: from.name },
        { lat: to.lat, lon: to.lon, name: to.name },
        date,
        time,
        timezone,
        arriveTimezone,
      )
      setOptions(result.connections)
    } catch (searchError) {
      setError(searchError instanceof ApiError ? searchError.code : 'network')
    } finally {
      setLoading(false)
    }
  }

  const use = (option: ConnectionOption) => {
    setConnection(journeyId, legIndex, {
      ...option,
      provider: 'transitous',
      checkedAt: new Date().toISOString(),
    })
    onClose()
  }

  return (
    <Modal
      open={open}
      title={t('connectionsTitle')}
      onClose={onClose}
      wide
      className="connection-modal"
      footer={<p className="muted small">{t('railTimetableNote')}</p>}
    >
      <p className="modal-copy">{t('connectionsBody')}</p>
      <div className="connection-query">
        <label className="field">
          <span className="field-label">{t('connectionDate')}</span>
          <input type="date" value={date} onChange={(event) => setDate(event.target.value)} />
        </label>
        <label className="field">
          <span className="field-label">{t('connectionTime')}</span>
          <input type="time" value={time} onChange={(event) => setTime(event.target.value)} />
        </label>
        <button
          type="button"
          className="button button-ink"
          onClick={() => void search()}
          disabled={loading || !date || !time}
        >
          {loading ? <Spinner size={15} /> : <CalendarIcon size={16} />}
          {loading ? t('searchingConnections') : t('findConnections')}
        </button>
      </div>
      <p className="muted small">
        {from.name} → {to.name} · {timezone}
      </p>

      {current ? (
        <div className="current-connection">
          <div>
            <span className="eyebrow">{t('exampleConnection')}</span>
            <strong>{current.summary}</strong>
            <span className="muted small">
              {current.depart} → {current.arrive} ·{' '}
              {current.transfers === 0
                ? t('direct')
                : `${current.transfers} ${t('transfers')}`}
            </span>
          </div>
          <button
            type="button"
            className="button button-quiet small"
            onClick={() => {
              setConnection(journeyId, legIndex, null)
              onClose()
            }}
          >
            {t('remove')}
          </button>
        </div>
      ) : null}

      {error === 'relay' ? (
        <div className="empty-note">
          <strong>{t('relayMissing')}</strong>
          <p>{t('relayMissingBody')}</p>
        </div>
      ) : error ? (
        <div className="empty-note">
          <strong>{t('networkError')}</strong>
          <p>{t('noConnectionsBody')}</p>
        </div>
      ) : null}

      {loading ? (
        <div className="connection-loading">
          <Spinner size={22} />
          <span>{t('searchingConnections')}</span>
        </div>
      ) : null}

      {options?.length === 0 ? (
        <div className="empty-note">
          <strong>{t('noConnections')}</strong>
          <p>{t('noConnectionsBody')}</p>
        </div>
      ) : null}

      {options && options.length > 0 ? (
        <div className="connection-list">
          {options.map((option, index) => (
            <div className="connection-card" key={`${option.summary}-${index}`}>
              <div className="connection-card-head">
                <div>
                  <span className="eyebrow">
                    {formatDate(option.serviceDate, locale, true)} · {option.timezone}
                  </span>
                  <strong>{option.summary}</strong>
                </div>
                <button type="button" className="button button-ink small" onClick={() => use(option)}>
                  {t('useConnection')}
                </button>
              </div>
              <div className="connection-times">
                <span>
                  {option.depart} <small>{from.name}</small>
                </span>
                <span className="connection-arrow">→</span>
                <span>
                  {option.arrive} <small>{to.name}</small>
                </span>
                {option.durationMinutes ? (
                  <span className="muted">· {formatDuration(option.durationMinutes, locale)}</span>
                ) : null}
                <span className="muted">
                  ·{' '}
                  {option.transfers === 0
                    ? t('direct')
                    : `${option.transfers} ${t('transfers')}`}
                </span>
              </div>
              {option.segments?.length ? (
                <ul className="connection-segments">
                  {option.segments.map((segment, segmentIndex) => (
                    <li key={`${segment.from}-${segmentIndex}`}>
                      <TrainIcon size={14} />
                      <span>
                        {segment.line ? <strong>{segment.line}</strong> : segment.mode}{' '}
                        {segment.from} → {segment.to}
                      </span>
                      <span className="muted">
                        {segment.depart}–{segment.arrive}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : null}
            </div>
          ))}
        </div>
      ) : null}
    </Modal>
  )
}
