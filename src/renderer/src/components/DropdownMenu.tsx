import { useEffect, useRef, useState } from 'react'
import { msgs } from '@shared/i18n'

export interface MenuItem {
  label: string
  onSelect: () => void
  /** Secondary line, for cost or consequence. */
  hint?: string
  danger?: boolean
  disabled?: boolean
  /** Inserts a divider above this item. */
  separatorBefore?: boolean
}

interface Props {
  items: MenuItem[]
  /** Accessible label for the button; visually it is always the "⋯". */
  label?: string
}

/**
 * Three-dot menu.
 *
 * Actions that cost money or delete data live here instead of on the bar: side
 * by side with the tabs they looked routine, and "Retranscribe" can cost as
 * much as recording the meeting again.
 */
export default function DropdownMenu({ items, label }: Props): JSX.Element {
  const [open, setOpen] = useState(false)
  const wrapperRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return

    const onPointerDown = (event: MouseEvent): void => {
      if (!wrapperRef.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setOpen(false)
    }

    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  return (
    <div className="menu-wrap" ref={wrapperRef}>
      <button
        className={`btn btn-ghost btn-sm menu-trigger${open ? ' active' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label ?? msgs().ui.dropdown.moreActions}
        onClick={() => setOpen((v) => !v)}
      >
        ⋯
      </button>

      {open && (
        <div className="menu" role="menu">
          {items.map((item, index) => (
            <div key={item.label}>
              {item.separatorBefore && index > 0 && <div className="menu-sep" />}
              <button
                role="menuitem"
                className={`menu-item${item.danger ? ' danger' : ''}`}
                disabled={item.disabled}
                onClick={() => {
                  setOpen(false)
                  item.onSelect()
                }}
              >
                <span>{item.label}</span>
                {item.hint && <small>{item.hint}</small>}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
