import {
  useEffect,
  useId,
  useRef,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { CloseIcon, UndoIcon } from './Icons'
import { useAtlasStore, useUIStore } from '@/store'
import { useT } from '@/i18n'

type ModalProps = {
  open: boolean
  title?: ReactNode
  onClose: () => void
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
  className?: string
  dismissible?: boolean
}

export function Modal({
  open,
  title,
  onClose,
  children,
  footer,
  wide,
  className,
  dismissible = true,
}: ModalProps) {
  const titleId = useId()
  const cardRef = useRef<HTMLDivElement>(null)
  const { t } = useT()

  useEffect(() => {
    if (!open) return
    const previous = document.activeElement as HTMLElement | null
    const html = document.documentElement
    const previousOverflow = html.style.overflow
    html.style.overflow = 'hidden'
    const handleKey = (event: KeyboardEvent) => {
      if (dismissible && event.key === 'Escape') {
        event.stopPropagation()
        onClose()
      }
    }
    document.addEventListener('keydown', handleKey)
    const timer = window.setTimeout(() => {
      const focusable = cardRef.current?.querySelector<HTMLElement>(
        'input, textarea, select, button, [href]',
      )
      focusable?.focus()
    }, 30)
    return () => {
      document.removeEventListener('keydown', handleKey)
      html.style.overflow = previousOverflow
      window.clearTimeout(timer)
      previous?.focus?.()
    }
  }, [open, onClose, dismissible])

  if (!open) return null

  return createPortal(
    <div
      className="modal-overlay"
      onMouseDown={(event) => {
        if (dismissible && event.target === event.currentTarget) onClose()
      }}
    >
      <div
        ref={cardRef}
        className={`modal-card ${wide ? 'is-wide' : ''} ${className ?? ''}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={title ? titleId : undefined}
      >
        <header className="modal-head">
          {title ? <h2 id={titleId}>{title}</h2> : <span />}
          {dismissible ? (
            <button
              type="button"
              className="icon-button"
              onClick={onClose}
              aria-label={t('closeDialog')}
            >
              <CloseIcon size={18} />
            </button>
          ) : (
            <span />
          )}
        </header>
        <div className="modal-body">{children}</div>
        {footer ? <footer className="modal-foot">{footer}</footer> : null}
      </div>
    </div>,
    document.body,
  )
}

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string
  hint?: string
  children: ReactNode
  className?: string
}) {
  return (
    <label className={`field ${className ?? ''}`}>
      <span className="field-label">{label}</span>
      {children}
      {hint ? <span className="field-hint">{hint}</span> : null}
    </label>
  )
}

export function Spinner({ size = 18 }: { size?: number }) {
  return (
    <span
      className="spinner"
      style={{ width: size, height: size, borderWidth: Math.max(1.5, size / 10) }}
      aria-hidden="true"
    />
  )
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onClose,
  danger = true,
}: {
  open: boolean
  title: string
  message: string
  confirmLabel: string
  cancelLabel: string
  onConfirm: () => void
  onClose: () => void
  danger?: boolean
}) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      className="confirm-modal"
      footer={
        <>
          <button type="button" className="button button-quiet" onClick={onClose}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`button ${danger ? 'button-danger' : 'button-ink'}`}
            onClick={() => {
              onConfirm()
              onClose()
            }}
          >
            {confirmLabel}
          </button>
        </>
      }
    >
      <p className="modal-copy">{message}</p>
    </Modal>
  )
}

export function Toast() {
  const toast = useUIStore((state) => state.toast)
  const clearToast = useUIStore((state) => state.clearToast)
  const undo = useAtlasStore((state) => state.undo)
  if (!toast) return null
  return (
    <div className="toast" role="status">
      <span>{toast.message}</span>
      {toast.undo ? (
        <button
          type="button"
          className="toast-action"
          onClick={() => {
            undo()
            clearToast()
          }}
        >
          <UndoIcon size={14} />
        </button>
      ) : null}
    </div>
  )
}
