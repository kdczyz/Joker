import type {
  WorkspaceDirectoryListResult,
  WorkspaceDirectoryTarget,
  WorkspaceEntry
} from '@shared/workspace-file'
import {
  ChevronDown,
  ChevronRight,
  Copy,
  FileText,
  Folder,
  FolderSearch,
  FolderOpen,
  Loader2,
  Plus,
  RefreshCw
} from 'lucide-react'
import {
  useEffect,
  useCallback,
  useMemo,
  useRef,
  useState,
  type DragEvent as ReactDragEvent,
  type MouseEvent as ReactMouseEvent,
  type ReactElement
} from 'react'
import type { TFunction } from 'i18next'
import type { ComposerFileReference } from '../../lib/composer-file-references'
import {
  COMPOSER_FILE_REFERENCE_DRAG_MIME,
  formatComposerFileMentionToken,
  relativeWorkspacePath
} from '../../lib/composer-file-references'
import { isWorkspaceTextPreviewPath } from '../../lib/workspace-text-preview'
import {
  SidebarIconButton,
  SidebarSectionHeader,
  SidebarTreeRow
} from '../sidebar/SidebarPrimitives'
import { currentBodyZoom } from '../../lib/body-zoom'

export type ChatFileTreeReference = ComposerFileReference & {
  type: 'file' | 'directory'
}

type Props = {
  workspaceRoot: string
  selectedPath?: string | null
  searchQuery?: string
  onPreviewFile: (path: string) => void
  onAddReference: (reference: ChatFileTreeReference) => void
  t: TFunction
  fill?: boolean
}

type DirectoryState = {
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
}

type ContextMenuState = {
  x: number
  y: number
  entry: WorkspaceEntry
} | null

type FileTreeSortMode = 'name' | 'modified'

type ListWorkspaceDirectory = (target: WorkspaceDirectoryTarget) => Promise<WorkspaceDirectoryListResult>

type RecentScanState = {
  entries: WorkspaceEntry[]
  loading: boolean
  error: string | null
}

type RecentScanOptions = {
  isCancelled?: () => boolean
  limit?: number
  maxDepth?: number
  maxEntries?: number
}

const ROOT_PATH = ''
const IGNORED_DIRS = new Set(['.git', '.hg', '.svn', 'node_modules'])
const RECENT_FILE_LIMIT = 8
const RECENT_SCAN_MAX_ENTRIES = 2_000
const RECENT_SCAN_MAX_DEPTH = 8

function normalizePath(path: string): string {
  return path.replaceAll('\\', '/').replace(/\/+$/g, '')
}

function pathKey(path: string): string {
  return normalizePath(path).toLowerCase()
}

function workspaceDisplayName(path: string): string {
  const normalized = normalizePath(path)
  const parts = normalized.split('/').filter(Boolean)
  return parts.at(-1) ?? path
}

function entryReference(entry: WorkspaceEntry, workspaceRoot: string): ChatFileTreeReference {
  const relativePath = relativeWorkspacePath(entry.path, workspaceRoot)
  return {
    path: entry.path,
    relativePath,
    name: entry.name,
    type: entry.type,
    workspaceRoot
  }
}

export function compareChatFileTreeEntriesByName(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' })
}

export function compareChatFileTreeEntriesByModified(left: WorkspaceEntry, right: WorkspaceEntry): number {
  if (left.type !== right.type) return left.type === 'directory' ? -1 : 1
  const leftTime = left.mtimeMs ?? 0
  const rightTime = right.mtimeMs ?? 0
  if (leftTime !== rightTime) return rightTime - leftTime
  return compareChatFileTreeEntriesByName(left, right)
}

export function sortChatFileTreeEntries(entries: WorkspaceEntry[], mode: FileTreeSortMode): WorkspaceEntry[] {
  return [...entries].sort(mode === 'modified' ? compareChatFileTreeEntriesByModified : compareChatFileTreeEntriesByName)
}

export function matchesChatFileTreeQuery(name: string, query: string): boolean {
  return name.toLowerCase().includes(query.trim().toLowerCase())
}

export function filterChatFileTreeEntries(
  entries: WorkspaceEntry[],
  query: string,
  getChildren: (path: string) => WorkspaceEntry[] | undefined
): WorkspaceEntry[] {
  const normalized = query.trim().toLowerCase()
  if (!normalized) return entries

  return entries.flatMap((entry) => {
    if (entry.type === 'directory' && isChatFileTreeIgnoredDirectory(entry.name)) return []
    const nameMatch = matchesChatFileTreeQuery(entry.name, normalized)
    if (entry.type === 'file') {
      return nameMatch ? [entry] : []
    }
    const children = getChildren(entry.path)
    const filteredChildren = children ? filterChatFileTreeEntries(children, normalized, getChildren) : []
    if (nameMatch || filteredChildren.length > 0) {
      return [{ ...entry }]
    }
    return []
  })
}

/**
 * 根据搜索词构建过滤后的文件树状态。返回每个已加载目录过滤后的 entries，
 * 以及需要自动展开的目录路径集合。
 */
export function buildChatFileTreeFilteredState(
  directories: Record<string, { entries: WorkspaceEntry[] } | undefined>,
  query: string
): { filteredEntries: Record<string, WorkspaceEntry[]>; expandedPaths: Set<string> } {
  const normalized = query.trim().toLowerCase()
  const filteredEntries: Record<string, WorkspaceEntry[]> = {}
  const expandedPaths = new Set<string>()

  if (!normalized) {
    for (const [key, state] of Object.entries(directories)) {
      filteredEntries[key] = state?.entries ?? []
    }
    return { filteredEntries, expandedPaths }
  }

  const visited = new Set<string>()

  function visit(path: string): WorkspaceEntry[] {
    const key = path || ROOT_PATH
    if (visited.has(key)) return filteredEntries[key] ?? []
    visited.add(key)

    const state = directories[key]
    if (!state) return []

    const result = state.entries.flatMap((entry) => {
      if (entry.type === 'directory' && isChatFileTreeIgnoredDirectory(entry.name)) return []
      const nameMatch = matchesChatFileTreeQuery(entry.name, normalized)
      if (entry.type === 'file') {
        return nameMatch ? [entry] : []
      }
      const children = visit(entry.path)
      if (nameMatch || children.length > 0) {
        if (children.length > 0) expandedPaths.add(entry.path)
        return [entry]
      }
      return []
    })

    filteredEntries[key] = result
    return result
  }

  visit(ROOT_PATH)
  return { filteredEntries, expandedPaths }
}

function sortRecentFiles(entries: WorkspaceEntry[]): WorkspaceEntry[] {
  return [...entries]
    .filter(isChatFileTreePreviewableEntry)
    .sort((left, right) => {
      const leftTime = left.mtimeMs ?? 0
      const rightTime = right.mtimeMs ?? 0
      if (leftTime !== rightTime) return rightTime - leftTime
      return compareChatFileTreeEntriesByName(left, right)
    })
}

export async function scanChatFileTreeRecentFiles(
  root: string,
  listWorkspaceDirectory: ListWorkspaceDirectory,
  options: RecentScanOptions = {}
): Promise<WorkspaceEntry[]> {
  const limit = options.limit ?? RECENT_FILE_LIMIT
  const maxDepth = options.maxDepth ?? RECENT_SCAN_MAX_DEPTH
  const maxEntries = options.maxEntries ?? RECENT_SCAN_MAX_ENTRIES
  const isCancelled = options.isCancelled ?? (() => false)
  const collected: WorkspaceEntry[] = []

  const scanDirectory = async (
    path: string,
    depth: number,
    seenDirectories: Set<string>
  ): Promise<void> => {
    if (isCancelled() || depth > maxDepth || collected.length >= maxEntries) return
    const directoryKey = pathKey(path || root)
    if (seenDirectories.has(directoryKey)) return
    seenDirectories.add(directoryKey)
    const result = await listWorkspaceDirectory({ workspaceRoot: root, path: path || root })
    if (!result.ok) throw new Error(result.message)
    for (const entry of result.entries) {
      if (isCancelled() || collected.length >= maxEntries) return
      if (entry.type === 'directory') {
        if (!isChatFileTreeIgnoredDirectory(entry.name)) {
          await scanDirectory(entry.path, depth + 1, seenDirectories)
        }
        continue
      }
      if (isChatFileTreePreviewableEntry(entry)) collected.push(entry)
    }
  }

  await scanDirectory(root, 0, new Set())
  return sortRecentFiles(collected).slice(0, limit)
}

/**
 * 扫描整个工作区，返回每个目录下的 entries（键与组件内部 directories state 一致）。
 * 用于搜索模式，确保过滤能覆盖未懒加载的目录。
 */
export async function scanChatFileTreeAllEntries(
  root: string,
  listWorkspaceDirectory: ListWorkspaceDirectory,
  options: RecentScanOptions = {}
): Promise<Record<string, WorkspaceEntry[]>> {
  const maxDepth = options.maxDepth ?? RECENT_SCAN_MAX_DEPTH
  const maxEntries = options.maxEntries ?? RECENT_SCAN_MAX_ENTRIES
  const isCancelled = options.isCancelled ?? (() => false)
  const collected: Record<string, WorkspaceEntry[]> = {}

  const scanDirectory = async (
    path: string,
    depth: number,
    seenDirectories: Set<string>
  ): Promise<void> => {
    if (isCancelled() || depth > maxDepth) return
    const directoryKey = pathKey(path || root)
    if (seenDirectories.has(directoryKey)) return
    seenDirectories.add(directoryKey)

    const result = await listWorkspaceDirectory({ workspaceRoot: root, path: path || root })
    if (!result.ok) {
      collected[path === root ? ROOT_PATH : path] = []
      return
    }

    const visibleEntries = sortChatFileTreeEntries(
      result.entries.filter((entry) => entry.type !== 'directory' || !isChatFileTreeIgnoredDirectory(entry.name)),
      'name'
    )
    collected[path === root ? ROOT_PATH : path] = visibleEntries

    for (const entry of visibleEntries) {
      if (isCancelled() || Object.keys(collected).length >= maxEntries) return
      if (entry.type === 'directory') {
        await scanDirectory(entry.path, depth + 1, seenDirectories)
      }
    }
  }

  await scanDirectory(root, 0, new Set())
  return collected
}

export function isChatFileTreeIgnoredDirectory(name: string): boolean {
  return IGNORED_DIRS.has(name.toLowerCase())
}

export function isChatFileTreePreviewableEntry(entry: WorkspaceEntry): boolean {
  return entry.type === 'file' && isWorkspaceTextPreviewPath(entry.path || entry.name)
}

export function formatChatFileTreeUnsupportedMessage(name: string): string {
  return `${name} is not a supported text preview.`
}

export function ChatFileTreePanel({
  workspaceRoot,
  selectedPath,
  searchQuery = '',
  onPreviewFile,
  onAddReference,
  t,
  fill = false
}: Props): ReactElement | null {
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set([ROOT_PATH]))
  const [directories, setDirectories] = useState<Record<string, DirectoryState>>({})
  const [contextMenu, setContextMenu] = useState<ContextMenuState>(null)
  const [sortMode, setSortMode] = useState<FileTreeSortMode>('name')
  const [recentScan, setRecentScan] = useState<RecentScanState>({ entries: [], loading: false, error: null })
  const [recentScanNonce, setRecentScanNonce] = useState(0)
  const [searchScan, setSearchScan] = useState<{
    directories: Record<string, DirectoryState>
    loading: boolean
    error: string | null
  }>({ directories: {}, loading: false, error: null })
  const menuRef = useRef<HTMLDivElement | null>(null)
  const root = workspaceRoot.trim()
  const rootName = useMemo(() => workspaceDisplayName(root), [root])
  const isSearching = searchQuery.trim().length > 0
  const searchSource = useMemo<Record<string, DirectoryState>>(
    () => (isSearching ? searchScan.directories : directories),
    [isSearching, searchScan.directories, directories]
  )
  const { filteredEntries, expandedPaths: searchExpandedPaths } = useMemo(
    () => buildChatFileTreeFilteredState(searchSource, searchQuery),
    [searchSource, searchQuery]
  )
  const effectiveExpanded = isSearching ? searchExpandedPaths : expanded

  useEffect(() => {
    setExpanded(new Set([ROOT_PATH]))
    setDirectories({})
    setContextMenu(null)
    setRecentScan({ entries: [], loading: false, error: null })
    setSearchScan({ directories: {}, loading: false, error: null })
  }, [root])

  const loadDirectory = useCallback((path: string): void => {
    if (!root || typeof window.JokerGui?.listWorkspaceDirectory !== 'function') return
    setDirectories((current) => ({
      ...current,
      [path || ROOT_PATH]: {
        entries: current[path || ROOT_PATH]?.entries ?? [],
        loading: true,
        error: null
      }
    }))
    void window.JokerGui
      .listWorkspaceDirectory({
        workspaceRoot: root,
        path: path || root
      })
      .then((result) => {
        setDirectories((current) => ({
          ...current,
          [path || ROOT_PATH]: result.ok
            ? { entries: result.entries, loading: false, error: null }
            : { entries: [], loading: false, error: result.message }
        }))
      })
      .catch((error) => {
        setDirectories((current) => ({
          ...current,
          [path || ROOT_PATH]: {
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          }
        }))
      })
  }, [root])

  useEffect(() => {
    for (const path of expanded) {
      const state = directories[path || ROOT_PATH]
      if (!state) loadDirectory(path)
    }
  }, [directories, expanded, loadDirectory, root])

  useEffect(() => {
    const listWorkspaceDirectory = window.JokerGui?.listWorkspaceDirectory?.bind(window.JokerGui)
    if (!root || typeof listWorkspaceDirectory !== 'function') return
    let cancelled = false
    setRecentScan({ entries: [], loading: true, error: null })

    void (async () => {
      try {
        const entries = await scanChatFileTreeRecentFiles(root, listWorkspaceDirectory, {
          isCancelled: () => cancelled
        })
        if (!cancelled) {
          setRecentScan({
            entries,
            loading: false,
            error: null
          })
        }
      } catch (error) {
        if (!cancelled) {
          setRecentScan({
            entries: [],
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [root, recentScanNonce])

  /* 搜索模式：一次性扫描整个工作区，用于过滤未懒加载的目录。 */
  useEffect(() => {
    if (!isSearching) {
      setSearchScan({ directories: {}, loading: false, error: null })
      return
    }
    if (Object.keys(searchScan.directories).length > 0) return

    const listWorkspaceDirectory = window.JokerGui?.listWorkspaceDirectory?.bind(window.JokerGui)
    if (!root || typeof listWorkspaceDirectory !== 'function') return
    let cancelled = false
    setSearchScan({ directories: {}, loading: true, error: null })

    void (async () => {
      try {
        const dirs = await scanChatFileTreeAllEntries(root, listWorkspaceDirectory, {
          isCancelled: () => cancelled
        })
        if (cancelled) return
        const directoryStates = Object.fromEntries(
          Object.entries(dirs).map(([key, entries]) => [
            key,
            { entries, loading: false, error: null } as DirectoryState
          ])
        )
        setSearchScan({ directories: directoryStates, loading: false, error: null })
      } catch (error) {
        if (!cancelled) {
          setSearchScan({
            directories: {},
            loading: false,
            error: error instanceof Error ? error.message : String(error)
          })
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [isSearching, root, searchScan.directories])

  useEffect(() => {
    if (!contextMenu) return
    const onPointerDown = (event: PointerEvent): void => {
      const target = event.target
      if (target instanceof Node && menuRef.current?.contains(target)) return
      setContextMenu(null)
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setContextMenu(null)
    }
    window.addEventListener('pointerdown', onPointerDown)
    window.addEventListener('keydown', onKeyDown)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [contextMenu])

  const selectedKey = useMemo(() => pathKey(selectedPath ?? ''), [selectedPath])
  const recentEntries = recentScan.entries

  if (!root) return null

  const toggleDirectory = (path: string): void => {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(path)) next.delete(path)
      else next.add(path)
      return next
    })
  }

  const refresh = (): void => {
    setDirectories({})
    setExpanded(new Set([ROOT_PATH]))
    setRecentScan((current) => ({
      entries: current.entries,
      loading: true,
      error: null
    }))
    setRecentScanNonce((value) => value + 1)
    setSearchScan({ directories: {}, loading: false, error: null })
  }

  const addReference = (entry: WorkspaceEntry): void => {
    onAddReference(entryReference(entry, root))
    setContextMenu(null)
  }

  const setEntryDragData = (event: ReactDragEvent<HTMLElement>, entry: WorkspaceEntry): void => {
    const reference = entryReference(entry, root)
    const token = formatComposerFileMentionToken(reference.relativePath, reference.type === 'directory')
    event.dataTransfer.effectAllowed = 'copy'
    event.dataTransfer.setData('text/plain', `${token} `)
    event.dataTransfer.setData(COMPOSER_FILE_REFERENCE_DRAG_MIME, JSON.stringify(reference))
  }

  const copyEntryPath = async (entry: WorkspaceEntry, mode: 'absolute' | 'relative'): Promise<void> => {
    if (!navigator?.clipboard?.writeText) return
    const value = mode === 'absolute' ? entry.path : relativeWorkspacePath(entry.path, root)
    await navigator.clipboard.writeText(value)
    setContextMenu(null)
  }

  const revealEntry = async (entry: WorkspaceEntry): Promise<void> => {
    if (typeof window.JokerGui?.openEditorPath !== 'function') return
    await window.JokerGui.openEditorPath({
      path: entry.path,
      workspaceRoot: root,
      editorId: 'file-manager'
    })
    setContextMenu(null)
  }

  const openContextMenu = (event: ReactMouseEvent<HTMLDivElement>, entry: WorkspaceEntry): void => {
    event.preventDefault()
    // clientX/Y are viewport-space; the fixed menu lives inside the zoomed
    // <body>, so convert to the zoomed coordinate space.
    const zoom = currentBodyZoom()
    setContextMenu({
      x: event.clientX / zoom,
      y: event.clientY / zoom,
      entry
    })
  }

  const renderDirectory = (path: string, depth: number): ReactElement[] => {
    const state = searchSource[path || ROOT_PATH]
    const rawEntries = state?.entries ?? []
    const entries = isSearching
      ? (filteredEntries[path || ROOT_PATH] ?? [])
      : rawEntries

    if (state?.loading && (!rawEntries.length || depth === 0)) {
      return [
        <div
          key={`${path}-loading`}
          className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-ds-muted"
          style={{ paddingLeft: depth * 14 + 10 }}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
          {t('fileTreeLoading')}
        </div>
      ]
    }
    if (state?.error) {
      return [
        <div
          key={`${path}-error`}
          className="px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300"
          style={{ paddingLeft: depth * 14 + 10 }}
          title={state.error}
        >
          {state.error}
        </div>
      ]
    }
    if (!entries.length) {
      return depth === 0
        ? [
            <div key={`${path}-empty`} className="px-2.5 py-2 text-[12px] text-ds-muted">
              {isSearching ? t('fileTreeNoMatches', { defaultValue: 'No files match your filter.' }) : t('fileTreeEmpty')}
            </div>
          ]
        : []
    }

    return sortChatFileTreeEntries(entries, sortMode)
      .filter((entry) => entry.type !== 'directory' || !isChatFileTreeIgnoredDirectory(entry.name))
      .flatMap((entry) => {
        const isDirectory = entry.type === 'directory'
        const entryExpanded = effectiveExpanded.has(entry.path)
        const previewable = isChatFileTreePreviewableEntry(entry)
        const active = !isDirectory && selectedKey === pathKey(entry.path)
        const icon = isDirectory
          ? entryExpanded
            ? <FolderOpen className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
            : <Folder className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
          : <FileText className="h-3.5 w-3.5 shrink-0 text-ds-muted" strokeWidth={1.75} />
        const row = (
          <div
            key={entry.path}
            draggable
            onDragStart={(event) => setEntryDragData(event, entry)}
          >
            <SidebarTreeRow
              title={previewable || isDirectory ? entry.path : formatChatFileTreeUnsupportedMessage(entry.name)}
              active={active}
              onClick={() => {
                if (isDirectory) {
                  if (!isSearching) toggleDirectory(entry.path)
                  return
                }
                onPreviewFile(entry.path)
              }}
              onContextMenu={(event) => openContextMenu(event, entry)}
              buttonClassName="items-center gap-1.5 py-1.5 pr-1.5 text-[12.5px]"
              buttonStyle={{ paddingLeft: depth * 14 + 8 }}
              trailing={
                isDirectory ? (
                  entryExpanded ? (
                    <ChevronDown className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  ) : (
                    <ChevronRight className="h-3.5 w-3.5 text-ds-faint" strokeWidth={1.8} />
                  )
                ) : null
              }
            >
              {icon}
              <span className={previewable || isDirectory ? 'min-w-0 truncate' : 'min-w-0 truncate text-ds-faint'}>
                {entry.name}
              </span>
            </SidebarTreeRow>
          </div>
        )
        if (!isDirectory || !entryExpanded) return [row]
        return [row, ...renderDirectory(entry.path, depth + 1)]
      })
  }

  const contextEntry = contextMenu?.entry
  const contextLabel = contextEntry?.type === 'directory'
    ? t('fileTreeAddFolderReference')
    : t('fileTreeAddFileReference')
  const sortTitle = sortMode === 'modified'
    ? t('fileTreeSortByName', { defaultValue: 'Sort by name' })
    : t('fileTreeSortByModifiedTime', { defaultValue: 'Sort by modified time' })

  return (
    <div className={`ds-no-drag min-h-0 ${fill ? 'flex h-full flex-col' : ''}`}>
      <SidebarSectionHeader
        label={rootName || t('fileTreeTitle')}
        title={root}
        actions={
          <>
            <SidebarIconButton
              title={sortTitle}
              ariaLabel={sortTitle}
              active={sortMode === 'modified'}
              onClick={() => setSortMode((mode) => mode === 'modified' ? 'name' : 'modified')}
            >
              <span className="text-[11px] font-semibold">{sortMode === 'modified' ? 'MT' : 'AZ'}</span>
            </SidebarIconButton>
            <SidebarIconButton
              title={t('fileTreeRefresh')}
              ariaLabel={t('fileTreeRefresh')}
              onClick={refresh}
            >
              <RefreshCw className="h-3.5 w-3.5" strokeWidth={1.8} />
            </SidebarIconButton>
          </>
        }
      />
      {!isSearching && (recentEntries.length || recentScan.loading || recentScan.error) ? (
        <div className="border-b border-ds-border-muted/60 px-1 pb-2">
          <div className="px-2.5 pb-1 text-[11px] font-medium text-ds-faint">
            {t('fileTreeRecentModifiedFiles', { defaultValue: 'Recent modified files' })}
          </div>
          <div className="flex flex-col gap-0.5">
            {recentScan.loading ? (
              <div className="flex items-center gap-2 px-2.5 py-1 text-[12px] text-ds-muted">
                <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
                {t('fileTreeScanningRecent', { defaultValue: 'Scanning workspace…' })}
              </div>
            ) : recentScan.error ? (
              <div className="px-2.5 py-1 text-[12px] text-red-700 dark:text-red-300" title={recentScan.error}>
                {recentScan.error}
              </div>
            ) : recentEntries.map((entry) => (
              <button
                key={`recent-${entry.path}`}
                type="button"
                draggable
                onDragStart={(event) => setEntryDragData(event, entry)}
                onClick={() => onPreviewFile(entry.path)}
                className="flex min-w-0 items-center gap-1.5 rounded-md px-2.5 py-1 text-left text-[12px] text-ds-muted transition hover:bg-ds-hover hover:text-ds-ink"
                title={entry.path}
              >
                <FileText className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
                <span className="min-w-0 truncate">{relativeWorkspacePath(entry.path, root)}</span>
              </button>
            ))}
          </div>
        </div>
      ) : null}
      <div className={`${fill ? 'min-h-0 flex-1' : 'max-h-[34vh] min-h-[96px]'} overflow-y-auto overflow-x-hidden px-1`}>
        {isSearching && searchScan.loading ? (
          <div className="flex items-center gap-2 px-2.5 py-2 text-[12px] text-ds-muted">
            <Loader2 className="h-3.5 w-3.5 animate-spin" strokeWidth={1.8} />
            {t('fileTreeScanning', { defaultValue: 'Scanning workspace…' })}
          </div>
        ) : isSearching && searchScan.error ? (
          <div className="px-2.5 py-2 text-[12px] leading-5 text-red-700 dark:text-red-300" title={searchScan.error}>
            {searchScan.error}
          </div>
        ) : (
          renderDirectory(ROOT_PATH, 0)
        )}
      </div>
      {contextEntry ? (
        <div
          ref={menuRef}
          className="fixed z-50 min-w-[190px] rounded-lg border border-ds-border bg-ds-card p-1 shadow-xl"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
        >
          <button
            type="button"
            role="menuitem"
            onClick={() => addReference(contextEntry)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Plus className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">{contextLabel}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyEntryPath(contextEntry, 'absolute')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Copy className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">{t('fileTreeCopyAbsolutePath')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void copyEntryPath(contextEntry, 'relative')}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <Copy className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">{t('fileTreeCopyRelativePath')}</span>
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => void revealEntry(contextEntry)}
            className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left text-[12.5px] font-medium text-ds-ink transition hover:bg-ds-hover"
          >
            <FolderSearch className="h-3.5 w-3.5 text-ds-muted" strokeWidth={1.9} />
            <span className="min-w-0 truncate">
              {window.JokerGui?.platform === 'darwin'
                ? t('fileTreeRevealInFinder')
                : t('fileTreeRevealInFileManager')}
            </span>
          </button>
        </div>
      ) : null}
    </div>
  )
}
