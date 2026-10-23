import { Fragment, type ReactNode } from 'react'
import { safeAssistantPath } from './navigation'

function inline(text: string): ReactNode[] {
  const parts = text.split(/(\[[^\]\n]{1,200}\]\([^\s)]{1,1000}\)|\*\*[^*\n]+\*\*|`[^`\n]+`)/g)
  return parts.map((part, index) => {
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(part)
    if (link) {
      const href = safeAssistantPath(link[2])
      return href ? (
        <a key={index} href={href} className="text-primary underline">
          {link[1]}
        </a>
      ) : (
        <Fragment key={index}>{link[1]}</Fragment>
      )
    }
    if (part.startsWith('**') && part.endsWith('**'))
      return <strong key={index}>{part.slice(2, -2)}</strong>
    if (part.startsWith('`') && part.endsWith('`'))
      return (
        <code key={index} className="rounded bg-surface-sunken px-1 font-mono text-xs">
          {part.slice(1, -1)}
        </code>
      )
    return <Fragment key={index}>{part}</Fragment>
  })
}

export function SafeMarkdown({ text }: { text: string }) {
  return (
    <div className="space-y-2 break-words text-sm leading-relaxed">
      {text
        .slice(0, 100_000)
        .split('\n')
        .map((line, i) => (
          <p key={i} className="min-h-4 whitespace-pre-wrap">
            {inline(line)}
          </p>
        ))}
    </div>
  )
}
