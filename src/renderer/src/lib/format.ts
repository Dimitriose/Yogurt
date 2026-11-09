import { msgs, locale } from '@shared/i18n'

export function formatClock(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(total / 3600)
  const m = Math.floor((total % 3600) / 60)
  const s = total % 60
  const mm = String(m).padStart(2, '0')
  const ss = String(s).padStart(2, '0')
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`
}

export function formatTimestamp(seconds: number): string {
  return formatClock(seconds * 1000)
}

export function formatDuration(ms: number): string {
  const minutes = Math.round(ms / 60000)
  if (minutes < 1) return msgs().ui.format.lessThanOneMinute
  if (minutes < 60) return `${minutes} min`
  const h = Math.floor(minutes / 60)
  const m = minutes % 60
  return m === 0 ? `${h} h` : `${h} h ${m} min`
}

/** "today, 2:30 PM" · "yesterday, 9:15 AM" · "Mar 12, 4:00 PM" (pt: "hoje, 14:30" · "ontem, 09:15" · "12 de mar, 16:00") */
export function formatWhen(iso: string): string {
  const date = new Date(iso)
  const m = msgs().ui.format
  const time = date.toLocaleTimeString(locale(), { hour: '2-digit', minute: '2-digit' })

  const startOfDay = (d: Date): number =>
    new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
  const days = Math.round((startOfDay(new Date()) - startOfDay(date)) / 86_400_000)

  if (days === 0) return m.today(time)
  if (days === 1) return m.yesterday(time)
  if (days < 7) {
    return `${date.toLocaleDateString(locale(), { weekday: 'long' })}, ${time}`
  }
  const day = date.toLocaleDateString(locale(), { day: 'numeric', month: 'short' })
  return `${day}, ${time}`
}

