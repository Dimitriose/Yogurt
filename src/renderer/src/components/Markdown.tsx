import { Fragment, type ReactNode } from 'react'

/**
 * Minimal markdown renderer, enough for the summary format the prompt
 * produces: headings, lists, checkboxes, bold, italic, inline code, quotes and
 * separators. It avoids a third-party dependency and, since it does not
 * interpret HTML, opens no injection surface for the model's text.
 */

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = []
  // Order matters: bold before italic so `**` is not broken.
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\*[^*]+\*|_[^_]+_)/g
  let lastIndex = 0
  let match: RegExpExecArray | null
  let i = 0

  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index))
    }
    const token = match[0]
    const key = `${keyPrefix}-i${i++}`
    if (token.startsWith('**')) {
      nodes.push(<strong key={key}>{token.slice(2, -2)}</strong>)
    } else if (token.startsWith('`')) {
      nodes.push(<code key={key}>{token.slice(1, -1)}</code>)
    } else {
      nodes.push(<em key={key}>{token.slice(1, -1)}</em>)
    }
    lastIndex = pattern.lastIndex
  }

  if (lastIndex < text.length) nodes.push(text.slice(lastIndex))
  return nodes
}

interface ListItem {
  text: string
  checked: boolean | null
}

function renderList(items: ListItem[], key: string): ReactNode {
  const isTaskList = items.some((it) => it.checked !== null)
  return (
    <ul key={key} className={isTaskList ? 'md-tasks' : undefined}>
      {items.map((item, idx) => (
        <li key={idx} className={item.checked ? 'md-done' : undefined}>
          {item.checked !== null && (
            <span className="md-check" aria-hidden="true">
              {item.checked ? '✓' : ''}
            </span>
          )}
          <span>{renderInline(item.text, `${key}-${idx}`)}</span>
        </li>
      ))}
    </ul>
  )
}

export default function Markdown({ source }: { source: string }): ReactNode {
  const lines = source.replace(/\r\n/g, '\n').split('\n')
  const blocks: ReactNode[] = []
  let listBuffer: ListItem[] = []
  let paragraphBuffer: string[] = []
  let key = 0

  const flushList = (): void => {
    if (listBuffer.length === 0) return
    blocks.push(renderList(listBuffer, `list-${key++}`))
    listBuffer = []
  }

  const flushParagraph = (): void => {
    if (paragraphBuffer.length === 0) return
    const text = paragraphBuffer.join(' ')
    blocks.push(<p key={`p-${key}`}>{renderInline(text, `p-${key++}`)}</p>)
    paragraphBuffer = []
  }

  const flushAll = (): void => {
    flushList()
    flushParagraph()
  }

  for (const raw of lines) {
    const line = raw.trimEnd()

    if (!line.trim()) {
      flushAll()
      continue
    }

    const heading = /^(#{1,6})\s+(.*)$/.exec(line)
    if (heading) {
      flushAll()
      const level = heading[1].length
      const content = renderInline(heading[2], `h-${key}`)
      const Tag = `h${Math.min(level + 1, 6)}` as 'h2' | 'h3' | 'h4' | 'h5' | 'h6'
      blocks.push(<Tag key={`h-${key++}`}>{content}</Tag>)
      continue
    }

    if (/^(-{3,}|\*{3,}|_{3,})$/.test(line.trim())) {
      flushAll()
      blocks.push(<hr key={`hr-${key++}`} />)
      continue
    }

    const quote = /^>\s?(.*)$/.exec(line)
    if (quote) {
      flushAll()
      blocks.push(
        <blockquote key={`q-${key}`}>{renderInline(quote[1], `q-${key++}`)}</blockquote>
      )
      continue
    }

    const bullet = /^\s*(?:[-*+]|\d+\.)\s+(.*)$/.exec(line)
    if (bullet) {
      flushParagraph()
      let text = bullet[1]
      let checked: boolean | null = null
      const task = /^\[([ xX])\]\s*(.*)$/.exec(text)
      if (task) {
        checked = task[1].toLowerCase() === 'x'
        text = task[2]
      }
      listBuffer.push({ text, checked })
      continue
    }

    flushList()
    paragraphBuffer.push(line.trim())
  }

  flushAll()

  return <Fragment>{blocks}</Fragment>
}
