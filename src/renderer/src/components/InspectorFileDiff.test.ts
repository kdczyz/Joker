import { describe, expect, it } from 'vitest'
import { buildSections, parseRows } from './InspectorFileDiff'

function ctx(count: number, startOld: number, startNew: number): string[] {
  return Array.from({ length: count }, (_, i) => ` old ${startOld + i} / new ${startNew + i}`)
}

describe('InspectorFileDiff parseRows', () => {
  it('assigns old/new line numbers from hunk headers and change types', () => {
    const patch = [
      'diff --git a/src/main/index.ts b/src/main/index.ts',
      '--- a/src/main/index.ts',
      '+++ b/src/main/index.ts',
      '@@ -10,4 +10,4 @@',
      ...ctx(2, 10, 10),
      '-removed old 12',
      '+added new 12',
      ' context 13'
    ].join('\n')

    const rows = parseRows(patch)
    expect(rows).toHaveLength(5)
    expect(rows[0]).toMatchObject({ type: 'ctx', oldNo: 10, newNo: 10 })
    expect(rows[1]).toMatchObject({ type: 'ctx', oldNo: 11, newNo: 11 })
    expect(rows[2]).toMatchObject({ type: 'del', oldNo: 12, newNo: null, content: 'removed old 12' })
    expect(rows[3]).toMatchObject({ type: 'add', oldNo: null, newNo: 12, content: 'added new 12' })
    expect(rows[4]).toMatchObject({ type: 'ctx', oldNo: 13, newNo: 13 })
  })

  it('drops metadata, "\\ No newline" markers and the trailing newline row', () => {
    const patch = [
      '--- a/file.ts',
      '+++ b/file.ts',
      '@@ -1,2 +1,2 @@',
      '-old',
      '\\ No newline at end of file',
      '+new',
      '\\ No newline at end of file',
      ''
    ].join('\n')

    const rows = parseRows(patch)
    expect(rows.map((row) => row.type)).toEqual(['del', 'add'])
  })

  it('numbers an all-additions patch without hunk headers from line 1', () => {
    const rows = parseRows(['+++ b/new.ts', '+first', '+second'].join('\n'))
    expect(rows.map((row) => row.newNo)).toEqual([1, 2])
  })
})

describe('InspectorFileDiff buildSections', () => {
  it('keeps short context runs inline', () => {
    const rows = parseRows(
      ['@@ -1,7 +1,7 @@', ...ctx(4, 1, 1), '-gone', '+here', ...ctx(2, 6, 6)].join('\n')
    )
    expect(buildSections(rows)).toHaveLength(1)
  })

  it('collapses long context runs into gap sections', () => {
    const patch = [
      '@@ -1,14 +1,3 @@',
      '-start',
      ...ctx(12, 2, 2),
      '-end'
    ].join('\n')
    const sections = buildSections(parseRows(patch))
    expect(sections).toHaveLength(3)
    expect(sections[0]).toMatchObject({ kind: 'block' })
    expect(sections[1]).toMatchObject({ kind: 'gap' })
    if (sections[1].kind === 'gap') expect(sections[1].rows).toHaveLength(12)
    expect(sections[2]).toMatchObject({ kind: 'block' })
  })
})
