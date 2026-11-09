import { useCallback, useRef, useState, type ReactNode } from 'react'
import { msgs } from '@shared/i18n'

/**
 * In-app confirmation, replacing `window.confirm`.
 *
 * **Why not the native one.** In Electron, the `window.confirm` modal dialog
 * steals focus from the web content and does not give it back on close: the
 * window is still drawn and responds to clicks, but no text field receives
 * keyboard input until the user clicks away and back. The symptom — "I can't
 * type in anything anymore" — has no apparent connection to the button that
 * opened the dialog, which makes the problem especially hard to diagnose.
 */

export interface ConfirmOptions {
  title: string
  message: string
  confirmLabel?: string
  cancelLabel?: string
  /** Styles the action as destructive. */
  danger?: boolean
}

interface Pending extends ConfirmOptions {
  resolve: (value: boolean) => void
}

export interface UseConfirm {
  /** Opens the dialog and resolves with the user's choice. */
  confirm: (options: ConfirmOptions) => Promise<boolean>
  /** Render this inside the view. */
  dialog: ReactNode
}

export function useConfirm(): UseConfirm {
  const [pending, setPending] = useState<Pending | null>(null)
  const confirmButtonRef = useRef<HTMLButtonElement>(null)

  const confirm = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve })
    })
  }, [])

  const settle = useCallback(
    (value: boolean) => {
      setPending((current) => {
        current?.resolve(value)
        return null
      })
    },
    []
  )

  const dialog = pending ? (
    <div
      className="modal-backdrop"
      role="presentation"
      onClick={(e) => {
        // Clicking outside cancels; clicking inside the card must not close it.
        if (e.target === e.currentTarget) settle(false)
      }}
    >
      <div
        className="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-title"
        onKeyDown={(e) => {
          if (e.key === 'Escape') settle(false)
          if (e.key === 'Enter') settle(true)
        }}
      >
        <h2 id="confirm-title">{pending.title}</h2>
        <p>{pending.message}</p>
        <div className="modal-actions">
          <button className="btn btn-ghost" onClick={() => settle(false)}>
            {pending.cancelLabel ?? msgs().ui.common.cancel}
          </button>
          <button
            ref={confirmButtonRef}
            className={pending.danger ? 'btn btn-danger-solid' : 'btn btn-primary'}
            autoFocus
            onClick={() => settle(true)}
          >
            {pending.confirmLabel ?? msgs().ui.common.confirm}
          </button>
        </div>
      </div>
    </div>
  ) : null

  return { confirm, dialog }
}
