import { useEffect, useRef } from 'react'
import { useAuth } from '../auth/AuthGate'

const AUTH_TOKEN_KEY = 'joker.auth.session.v1'

/**
 * Headless component that auto-connects the desktop agent to the
 * Cloudflare remote server when the user is authenticated.
 *
 * This ensures the desktop is visible to the mobile app even when
 * the Settings page is not open – which is the root cause of the
 * "Code 模式无法解锁" bug.
 *
 * Mount once near the top of the component tree (inside AuthGate).
 */
export function RemoteAgentConnector(): null {
  const { user } = useAuth()
  const authenticated = Boolean(user) && !user.isGuest
  const autoConnectAttempted = useRef(false)

  useEffect(() => {
    // Authenticate → start
    if (authenticated && !autoConnectAttempted.current) {
      const token = localStorage.getItem(AUTH_TOKEN_KEY)
      if (!token) return
      autoConnectAttempted.current = true
      void window.JokerGui?.remoteAgent?.start(token)
    }

    // De-authenticate → stop
    if (!authenticated && autoConnectAttempted.current) {
      autoConnectAttempted.current = false
      void window.JokerGui?.remoteAgent?.stop()
    }
  }, [authenticated])

  // Also stop on unmount (e.g. guest mode / logout)
  useEffect(() => {
    return () => {
      void window.JokerGui?.remoteAgent?.stop()
    }
  }, [])

  return null
}
