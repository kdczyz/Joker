import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  defaultLegacySourceCandidates,
  detectLegacySessions,
  importLegacySessions
} from './legacy-session-import-service'

const tempRoots: string[] = []

async function makeTempRoot(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'Joker-session-import-'))
  tempRoots.push(root)
  return root
}

/** Create a thread folder with a minimal metadata.jsonl so it hydrates like the real store. */
async function writeThread(threadsDir: string, threadId: string, title = threadId): Promise<void> {
  const dir = join(threadsDir, threadId)
  await mkdir(dir, { recursive: true })
  const metadata = {
    kind: 'thread_metadata',
    version: 1,
    timestamp: '2026-06-15T00:00:00.000Z',
    thread: { id: threadId, title, turns: [] }
  }
  await writeFile(join(dir, 'metadata.jsonl'), `${JSON.stringify(metadata)}\n`, 'utf8')
  await writeFile(join(dir, 'messages.jsonl'), '', 'utf8')
  await writeFile(join(dir, 'events.jsonl'), '', 'utf8')
}

afterEach(async () => {
  while (tempRoots.length > 0) {
    const root = tempRoots.pop()
    if (root) await rm(root, { recursive: true, force: true })
  }
})

describe('defaultLegacySourceCandidates', () => {
  it('points at the legacy DeepSeek GUI Joker and coreagent threads dirs', () => {
    const candidates = defaultLegacySourceCandidates('/home/zoe')
    expect(candidates.map((c) => c.path)).toEqual([
      join('/home/zoe', '.deepseekgui', 'Joker', 'threads'),
      join('/home/zoe', '.deepseekgui', 'coreagent', 'threads')
    ])
    expect(candidates.map((c) => c.kind)).toEqual(['Joker', 'coreagent'])
  })
})

describe('detectLegacySessions', () => {
  it('reports thread counts and how many are new vs the destination', async () => {
    const root = await makeTempRoot()
    const JokerThreads = join(root, '.deepseekgui', 'Joker', 'threads')
    await writeThread(JokerThreads, 'thr_a')
    await writeThread(JokerThreads, 'thr_b')
    const coreagentThreads = join(root, '.deepseekgui', 'coreagent', 'threads')
    await writeThread(coreagentThreads, 'thr_c')
    // One of the Joker threads already exists in the destination.
    const dataDir = join(root, '.Joker', 'data')
    await writeThread(join(dataDir, 'threads'), 'thr_a')

    const detection = await detectLegacySessions({ homeDir: root, destDataDir: dataDir })

    expect(detection.destDir).toBe(join(dataDir, 'threads'))
    const Joker = detection.sources.find((s) => s.kind === 'Joker')
    expect(Joker).toMatchObject({ threadCount: 2, newCount: 1 })
    const coreagent = detection.sources.find((s) => s.kind === 'coreagent')
    expect(coreagent).toMatchObject({ threadCount: 1, newCount: 1 })
  })

  it('omits sources that do not exist', async () => {
    const root = await makeTempRoot()
    await writeThread(join(root, '.deepseekgui', 'Joker', 'threads'), 'thr_a')
    const detection = await detectLegacySessions({
      homeDir: root,
      destDataDir: join(root, '.Joker', 'data')
    })
    expect(detection.sources.map((s) => s.kind)).toEqual(['Joker'])
  })
})

describe('importLegacySessions', () => {
  it('copies all auto-detected legacy threads into the destination', async () => {
    const root = await makeTempRoot()
    await writeThread(join(root, '.deepseekgui', 'Joker', 'threads'), 'thr_a')
    await writeThread(join(root, '.deepseekgui', 'Joker', 'threads'), 'thr_b')
    await writeThread(join(root, '.deepseekgui', 'coreagent', 'threads'), 'thr_c')
    const dataDir = join(root, '.Joker', 'data')

    const summary = await importLegacySessions({ homeDir: root, destDataDir: dataDir })

    expect(summary).toMatchObject({ total: 3, imported: 3, skipped: 0 })
    const copied = (await readdir(join(dataDir, 'threads'))).sort()
    expect(copied).toEqual(['thr_a', 'thr_b', 'thr_c'])
    // Content is copied verbatim (no transformation).
    const meta = await readFile(join(dataDir, 'threads', 'thr_a', 'metadata.jsonl'), 'utf8')
    expect(meta).toContain('"id":"thr_a"')
  })

  it('never overwrites a thread that already exists in the destination', async () => {
    const root = await makeTempRoot()
    await writeThread(join(root, '.deepseekgui', 'Joker', 'threads'), 'thr_a', 'legacy title')
    const dataDir = join(root, '.Joker', 'data')
    await writeThread(join(dataDir, 'threads'), 'thr_a', 'current title')

    const summary = await importLegacySessions({ homeDir: root, destDataDir: dataDir })

    expect(summary).toMatchObject({ total: 1, imported: 0, skipped: 1 })
    const meta = await readFile(join(dataDir, 'threads', 'thr_a', 'metadata.jsonl'), 'utf8')
    expect(meta).toContain('current title')
    expect(meta).not.toContain('legacy title')
  })

  it('imports from an explicitly chosen folder, descending into a threads subdir', async () => {
    const root = await makeTempRoot()
    // User picks the parent (…/backup/Joker), not the threads dir itself.
    const pickedParent = join(root, 'backup', 'Joker')
    await writeThread(join(pickedParent, 'threads'), 'thr_x')
    const dataDir = join(root, '.Joker', 'data')

    const summary = await importLegacySessions({
      homeDir: root,
      destDataDir: dataDir,
      sourceDir: pickedParent
    })

    expect(summary).toMatchObject({ total: 1, imported: 1, skipped: 0 })
    expect(await readdir(join(dataDir, 'threads'))).toEqual(['thr_x'])
  })

  it('ignores non-thread entries and accepts marker-only folders', async () => {
    const root = await makeTempRoot()
    const source = join(root, 'backup')
    await writeThread(source, 'thr_a')
    // A loose index file and an unrelated directory must be ignored.
    await writeFile(join(source, 'index.json'), '{}', 'utf8')
    await mkdir(join(source, 'notes'), { recursive: true })
    await writeFile(join(source, 'notes', 'todo.txt'), 'hi', 'utf8')
    // A folder without the thr_ prefix but containing a thread marker is accepted.
    const oddDir = join(source, 'session-1')
    await mkdir(oddDir, { recursive: true })
    await writeFile(join(oddDir, 'thread.json'), '{"id":"session-1","title":"x","turns":[]}', 'utf8')
    const dataDir = join(root, '.Joker', 'data')

    const summary = await importLegacySessions({
      homeDir: root,
      destDataDir: dataDir,
      sourceDir: source
    })

    expect(summary.imported).toBe(2)
    expect((await readdir(join(dataDir, 'threads'))).sort()).toEqual(['session-1', 'thr_a'])
  })

  it('returns zero when there is nothing to import', async () => {
    const root = await makeTempRoot()
    const summary = await importLegacySessions({
      homeDir: root,
      destDataDir: join(root, '.Joker', 'data')
    })
    expect(summary).toMatchObject({ total: 0, imported: 0, skipped: 0 })
  })
})
