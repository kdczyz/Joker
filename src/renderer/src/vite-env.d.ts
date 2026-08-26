/// <reference types="vite/client" />

import type { DetailedHTMLProps, HTMLAttributes } from 'react'

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      webview: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> & {
        allowpopups?: string
        partition?: string
        src?: string
        webpreferences?: string
      }
    }
  }
}

interface JokerAuthUser {
  id: string
  email: string
  username: string
  displayName: string
  createdAt: string
  lastLoginAt?: string
  isGuest?: boolean
}

interface JokerAuthSession {
  user: JokerAuthUser
  expiresAt: string
}

declare global {
  interface Window {
    agentDesktop?: {
      platform: string
      isDesktopClient: boolean
      getLocalApiToken?: () => Promise<string | undefined>
      authSession?: () => Promise<JokerAuthSession | undefined>
      authLogin?: (details: { identifier: string; password: string }) => Promise<JokerAuthSession>
      authRegister?: (details: { email: string; username: string; displayName: string; password: string }) => Promise<JokerAuthSession>
      authLogout?: () => Promise<{ ok: boolean }>
    }
  }
}
