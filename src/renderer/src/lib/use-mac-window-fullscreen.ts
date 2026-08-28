import { useEffect } from 'react'

/**
 * 把 macOS 窗口原生全屏状态写到 <html data-mac-fullscreen> 上:
 * 全屏时原生红绿灯隐藏,依赖红绿灯定位的窗口按钮(如侧边栏展开/收起)
 * 通过 CSS `[data-mac-fullscreen='true']` 自适应换位。非 macOS 平台为空操作。
 */
export function useMacWindowFullscreenFlag(): void {
  useEffect(() => {
    const gui = window.JokerGui
    if (!gui?.windowChrome || gui.platform !== 'darwin') return
    let cancelled = false
    void gui.windowChrome.isFullscreen().then((isFullscreen) => {
      if (!cancelled) {
        document.documentElement.dataset.macFullscreen = isFullscreen ? 'true' : 'false'
      }
    })
    const unsubscribe = gui.windowChrome.onFullscreenChange((isFullscreen) => {
      document.documentElement.dataset.macFullscreen = isFullscreen ? 'true' : 'false'
    })
    return () => {
      cancelled = true
      unsubscribe()
      delete document.documentElement.dataset.macFullscreen
    }
  }, [])
}
