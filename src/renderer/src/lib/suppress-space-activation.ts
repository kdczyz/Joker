/**
 * 浏览器默认行为:按钮被鼠标点击后会持有焦点,此时按空格会在 keyup
 * 阶段合成一次 click(按住空格还会出现 :active 按下效果)。这个默认
 * 激活在本应用里容易造成误触(如再次打开权限菜单),因此在捕获阶段
 * 统一拦掉:目标是按钮类元素且按键为空格时 preventDefault,空格既不
 * 再触发 click 也不触发按下态。Enter 激活与输入框内的空格输入不受影响。
 */

type ElementLike = {
  tagName?: unknown
  getAttribute?: (name: string) => string | null
}

export function isButtonLikeElement(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const element = target as ElementLike
  if (typeof element.tagName !== 'string') return false
  if (element.tagName === 'BUTTON') return true
  const role = element.getAttribute?.('role')
  return role === 'button' || role === 'menuitem' || role === 'menuitemradio' || role === 'menuitemcheckbox'
}

export function installSpaceActivationSuppressor(): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== ' ') return
    if (event.defaultPrevented) return
    if (!isButtonLikeElement(event.target)) return
    event.preventDefault()
  }
  window.addEventListener('keydown', onKeyDown, true)
  return () => window.removeEventListener('keydown', onKeyDown, true)
}
