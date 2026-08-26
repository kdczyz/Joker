import type { ReactElement } from 'react'
import type { JokerRuntimeStatusPayload } from '@shared/Joker-gui-api'
import { RuntimeBanner } from '../RuntimeBanner'
import {
  resolveWriteRuntimeBannerMessage,
  type RuntimeConnectionLike
} from '../../lib/write-runtime-banner'
import { shouldSuppressRuntimeErrorBanner } from '../../lib/runtime-banner-visibility'

type UseWorkbenchRuntimeBannersInput = {
  runtimeStatus: JokerRuntimeStatusPayload | null
  runtimeConnection: RuntimeConnectionLike
  runtimeLogPath: string
  runtimeError: string | null
  runtimeErrorDetail?: string | null
  activeThreadId: string | null
  stageInsetClass: string
  runtimeActionNeedsConnection: string
  t: (key: string) => string
  onOpenSettings: () => void
  onRetryConnection: () => void
}

export function useWorkbenchRuntimeBanners({
  runtimeStatus,
  runtimeConnection,
  runtimeLogPath,
  runtimeError,
  runtimeErrorDetail,
  activeThreadId,
  stageInsetClass,
  runtimeActionNeedsConnection,
  t,
  onOpenSettings,
  onRetryConnection
}: UseWorkbenchRuntimeBannersInput): {
  writeRuntimeBanner: ReactElement | null
  conversationRuntimeBanner: ReactElement | null
} {
  const runtimeErrorSuppressed = shouldSuppressRuntimeErrorBanner(runtimeStatus)
  const visibleRuntimeError = runtimeErrorSuppressed ? null : runtimeError
  const visibleRuntimeErrorDetail = runtimeErrorSuppressed ? null : runtimeErrorDetail
  const writeRuntimeBannerMessage = resolveWriteRuntimeBannerMessage({
    runtimeConnection,
    error: visibleRuntimeError,
    runtimeActionNeedsConnection
  })

  const renderRuntimeBanner = (message: string, detail?: string | null): ReactElement => (
    <RuntimeBanner
      message={message}
      detail={detail}
      logPath={runtimeLogPath || null}
      runtimeReady={runtimeConnection === 'ready'}
      stageInsetClass={stageInsetClass}
      onOpenLogDir={
        typeof window !== 'undefined' && typeof window.JokerGui?.openLogDir === 'function'
          ? () => window.JokerGui.openLogDir()
          : undefined
      }
      onOpenSettings={onOpenSettings}
      onRetryConnection={onRetryConnection}
      t={t}
    />
  )

  return {
    writeRuntimeBanner: writeRuntimeBannerMessage
      ? renderRuntimeBanner(writeRuntimeBannerMessage, visibleRuntimeErrorDetail)
      : null,
    conversationRuntimeBanner:
      visibleRuntimeError && !(runtimeConnection !== 'ready' && !activeThreadId)
        ? renderRuntimeBanner(visibleRuntimeError, visibleRuntimeErrorDetail)
        : null
  }
}
