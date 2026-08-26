import type { MemoryCategory } from '../contracts/memory.js'

type MemoryLike = {
  id: string
  content: string
  scope: string
  category?: MemoryCategory
}

const CATEGORY_ORDER: ReadonlyArray<MemoryCategory> = ['pinned', 'long', 'short', 'session']

const CATEGORY_LABEL: Record<MemoryCategory, string> = {
  pinned: 'Pinned memories (always present, user-curated):',
  long: 'Long-term memories:',
  short: 'Short-term memories (temporary):',
  session: 'Session memories (expire this session):'
}

export function memoryInstructions(memories: ReadonlyArray<MemoryLike>): string[] {
  if (memories.length === 0) return []
  const buckets = new Map<MemoryCategory, MemoryLike[]>()
  for (const memory of memories) {
    const category: MemoryCategory = memory.category ?? 'long'
    const list = buckets.get(category) ?? []
    list.push(memory)
    buckets.set(category, list)
  }
  const sections: string[] = []
  for (const category of CATEGORY_ORDER) {
    const list = buckets.get(category)
    if (!list || list.length === 0) continue
    sections.push([
      CATEGORY_LABEL[category],
      ...list.map((memory) => `- [${memory.id}] (${memory.scope}) ${memory.content}`)
    ].join('\n'))
  }
  return sections.length > 0 ? sections : []
}
