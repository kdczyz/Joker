import {
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
  type ReactElement
} from 'react'
import { ChevronUp, ChevronsUpDown } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  highlightDiffTokens,
  languageFromFilePath,
  type DiffToken
} from '../lib/code-highlighting'

/**
 * Inline unified-diff renderer for the change inspector: syntax-highlighted
 * rows with a single line-number gutter, tinted add/remove rows with edge
 * markers, and long runs of untouched context collapsed behind an
 * "N unmodified lines" expander (like editor diff gutters).
 */

type ChangeType = 'add' | 'del' | 'ctx'

type ChangeRow = {
  kind: 'change'
  type: ChangeType
  index: number
  oldNo: number | null
  newNo: number | null
  content: string
}

type GapSection = { kind: 'gap'; id: string; rows: ChangeRow[] }
type BlockSection = { kind: 'block'; rows: ChangeRow[] }
type Section = BlockSection | GapSection

/** Runs of context lines longer than this get collapsed into an expander. */
const COLLAPSE_THRESHOLD = 8

const HUNK_HEADER = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export function parseRows(patch: string): ChangeRow[] {
  const rows: ChangeRow[] = []
  let oldNo = 1
  let newNo = 1
  let inHunk = false

  for (const line of patch.split('\n')) {
    if (line.startsWith('@@')) {
      inHunk = true
      const match = HUNK_HEADER.exec(line)
      if (match) {
        oldNo = parseInt(match[1], 10)
        newNo = parseInt(match[2], 10)
      }
      continue
    }
    if (!inHunk) {
      // Header-less patches (e.g. synthesized for untracked files) still have
      // usable +/- rows; skip only file-metadata lines.
      if (line.startsWith('+++') || line.startsWith('---')) continue
      if (line.startsWith('+')) {
        rows.push({ kind: 'change', type: 'add', index: rows.length, oldNo: null, newNo, content: line.slice(1) || ' ' })
        newNo += 1
      } else if (line.startsWith('-')) {
        rows.push({ kind: 'change', type: 'del', index: rows.length, oldNo, newNo: null, content: line.slice(1) || ' ' })
        oldNo += 1
      }
      continue
    }
    if (line.startsWith('+')) {
      rows.push({ kind: 'change', type: 'add', index: rows.length, oldNo: null, newNo, content: line.slice(1) || ' ' })
      newNo += 1
    } else if (line.startsWith('-')) {
      rows.push({ kind: 'change', type: 'del', index: rows.length, oldNo, newNo: null, content: line.slice(1) || ' ' })
      oldNo += 1
    } else if (line.startsWith('\\')) {
      // "\ No newline at end of file" — not a real row.
    } else {
      rows.push({ kind: 'change', type: 'ctx', index: rows.length, oldNo, newNo, content: line.startsWith(' ') ? line.slice(1) : line || ' ' })
      oldNo += 1
      newNo += 1
    }
  }

  // A trailing empty context row is just the final newline of the patch.
  while (rows.length > 0 && rows[rows.length - 1].content === ' ' && rows[rows.length - 1].type === 'ctx') {
    rows.pop()
  }
  return rows
}

export function buildSections(rows: ChangeRow[]): Section[] {
  const sections: Section[] = []
  let block: ChangeRow[] = []
  let contextRun: ChangeRow[] = []

  const endRun = (): void => {
    if (contextRun.length === 0) return
    if (contextRun.length > COLLAPSE_THRESHOLD) {
      if (block.length > 0) {
        sections.push({ kind: 'block', rows: block })
        block = []
      }
      sections.push({ kind: 'gap', id: `gap-${sections.length}`, rows: contextRun })
    } else {
      block.push(...contextRun)
    }
    contextRun = []
  }

  for (const row of rows) {
    if (row.type === 'ctx') {
      contextRun.push(row)
      continue
    }
    endRun()
    block.push(row)
  }
  endRun()
  if (block.length > 0) sections.push({ kind: 'block', rows: block })
  return sections
}

function tokenStyle(token: DiffToken): CSSProperties {
  const style: CSSProperties & Record<string, string | number> = {}
  if (token.color) style.color = token.color
  if (token.htmlStyle) {
    for (const [property, value] of Object.entries(token.htmlStyle)) {
      if (property.startsWith('--')) style[property] = value
    }
  }
  if (token.fontStyle != null) {
    if (token.fontStyle & 1) style.fontStyle = 'italic'
    if (token.fontStyle & 2) style.fontWeight = 600
    if (token.fontStyle & 4) style.textDecoration = 'underline'
  }
  return style
}

function CodeContent({ content, tokenLine }: { content: string; tokenLine?: DiffToken[] }): ReactElement {
  if (!tokenLine) return <span>{content}</span>
  return (
    <span>
      {tokenLine.map((token, i) => (
        <span key={i} style={tokenStyle(token)}>{token.content}</span>
      ))}
    </span>
  )
}

function DiffLine({ row, tokenLine }: { row: ChangeRow; tokenLine?: DiffToken[] }): ReactElement {
  const tint =
    row.type === 'add'
      ? 'bg-ds-diff-added-soft'
      : row.type === 'del'
        ? 'bg-ds-diff-removed-soft'
        : ''
  let markerStyle: CSSProperties | undefined
  if (row.type === 'add') markerStyle = { backgroundColor: 'var(--ds-diff-added)' }
  else if (row.type === 'del') {
    markerStyle = {
      backgroundImage:
        'repeating-linear-gradient(135deg, var(--ds-diff-removed) 0 1.5px, transparent 1.5px 3.5px)'
    }
  }
  const lineNo = row.type === 'del' ? row.oldNo : row.newNo

  return (
    <div className={`flex min-w-max leading-[1.8] ${tint}`}>
      <span className="w-[5px] shrink-0 self-stretch" style={markerStyle} />
      <span className="w-11 shrink-0 select-none pr-2.5 text-right text-[11px] tabular-nums text-ds-faint">
        {lineNo ?? ''}
      </span>
      <span className="ds-diff-code whitespace-pre pr-6 text-[12px] text-ds-ink">
        <CodeContent content={row.content} tokenLine={tokenLine} />
      </span>
    </div>
  )
}

export function InspectorFileDiff({
  patch,
  filePath
}: {
  patch: string
  filePath: string
}): ReactElement {
  const { t } = useTranslation('common')
  const rows = useMemo(() => parseRows(patch), [patch])
  const sections = useMemo(() => buildSections(rows), [rows])
  const [expandedGaps, setExpandedGaps] = useState<ReadonlySet<string>>(new Set())
  const [tokens, setTokens] = useState<DiffToken[][] | null>(null)

  useEffect(() => {
    setExpandedGaps(new Set())
  }, [patch])

  useEffect(() => {
    let cancelled = false
    setTokens(null)
    const code = rows.map((row) => row.content).join('\n')
    void highlightDiffTokens(code, languageFromFilePath(filePath)).then((result) => {
      if (!cancelled) setTokens(result)
    })
    return () => {
      cancelled = true
    }
  }, [rows, filePath])

  const toggleGap = (id: string): void => {
    setExpandedGaps((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  if (rows.length === 0) {
    return (
      <div className="px-4 py-5 text-center text-[11px] text-ds-faint">
        {t('inspectorNoDiffPreview')}
      </div>
    )
  }

  return (
    <div className="ds-inspector-diff min-w-0 overflow-x-auto border-y border-ds-border-muted/60 bg-ds-surface-soft/40 py-1.5 font-mono">
      {sections.map((section) => {
        if (section.kind === 'gap') {
          const expanded = expandedGaps.has(section.id)
          return expanded ? (
            <div key={section.id}>
              {section.rows.map((row) => (
                <DiffLine key={row.index} row={row} tokenLine={tokens?.[row.index]} />
              ))}
              <button
                type="button"
                onClick={() => toggleGap(section.id)}
                className="mx-2 my-1 flex items-center gap-2 rounded-md bg-ds-hover/80 px-2.5 py-1 text-left text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
              >
                <ChevronUp className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
                {t('inspectorUnmodifiedLines', { count: section.rows.length })}
              </button>
            </div>
          ) : (
            <button
              key={section.id}
              type="button"
              onClick={() => toggleGap(section.id)}
              className="mx-2 my-1 flex items-center gap-2 rounded-md bg-ds-hover/80 px-2.5 py-1 text-left text-[11px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
            >
              <ChevronsUpDown className="h-3.5 w-3.5 shrink-0" strokeWidth={2} />
              {t('inspectorUnmodifiedLines', { count: section.rows.length })}
            </button>
          )
        }
        return (
          <div key={`block-${section.rows[0]?.index ?? 'empty'}`}>
            {section.rows.map((row) => (
              <DiffLine key={row.index} row={row} tokenLine={tokens?.[row.index]} />
            ))}
          </div>
        )
      })}
    </div>
  )
}
