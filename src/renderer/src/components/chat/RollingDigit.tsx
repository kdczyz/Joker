import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'

/**
 * 单个滚动数字位。当 digit 变化时，像机械表一样向下滚动。
 * 使用 CSS transform + useReducer 确保无 stale closure。
 */
function RollingDigit({
  digit,
  delayMs = 0
}: {
  digit: number
  delayMs?: number
}): ReactElement {
  const [offset, dispatch] = useReducer(
    (state: number, action: { digit: number }) => {
      // 总是向下滚动（正方向），如果需要回绕则加 10
      const from = state % 10
      const to = action.digit
      const diff = to >= from ? to - from : 10 - from + to
      return state + diff
    },
    digit
  )

  const prevDigitRef = useRef(digit)

  useEffect(() => {
    if (prevDigitRef.current === digit) return
    prevDigitRef.current = digit
    dispatch({ digit })
  }, [digit])

  const lineHeight = 1.2

  return (
    <span
      style={{
        display: 'inline-block',
        overflow: 'hidden',
        height: `${lineHeight}em`,
        lineHeight: `${lineHeight}em`,
        verticalAlign: 'bottom'
      }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          transform: `translateY(-${offset * lineHeight}em)`,
          transition: `transform 400ms cubic-bezier(0.25, 0.1, 0.25, 1) ${delayMs}ms`,
          willChange: 'transform'
        }}
      >
        {Array.from({ length: 40 }, (_, i) => (
          <span
            key={i}
            style={{
              height: `${lineHeight}em`,
              lineHeight: `${lineHeight}em`,
              textAlign: 'center'
            }}
          >
            {i % 10}
          </span>
        ))}
      </span>
    </span>
  )
}

import { useReducer } from 'react'

/**
 * 滚动数字计数器。数字变化时每一位独立滚动动画。
 * 个位最先滚动，十位延迟 50ms，百位延迟 100ms。
 */
export function DiffCounter({
  value,
  prefix,
  className
}: {
  value: number
  prefix?: '+' | '-'
  className?: string
}): ReactElement {
  const abs = Math.abs(value)
  const digits = String(abs)

  return (
    <span
      className={`inline-flex items-center font-mono font-semibold tabular-nums ${className ?? ''}`}
    >
      {prefix ? <span className="mr-px">{prefix}</span> : null}
      {digits.split('').map((_, i) => {
        const placeFromRight = digits.length - 1 - i
        const delayMs = placeFromRight * 50
        const digitValue = Math.floor(abs / Math.pow(10, placeFromRight)) % 10
        return (
          <RollingDigit key={placeFromRight} digit={digitValue} delayMs={delayMs} />
        )
      })}
    </span>
  )
}
