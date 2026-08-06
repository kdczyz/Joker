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

interface RcodeAuthUser {
  id: string
  email: string
  username: string
  displayName: string
  createdAt: string
  lastLoginAt?: string
  isGuest?: boolean
}

interface RcodeAuthSession {
  user: RcodeAuthUser
  expiresAt: string
}

interface Window {
  agentDesktop?: {
    platform: string
    isDesktopClient: boolean
    getLocalApiToken?: () => Promise<string | undefined>
    authSession?: () => Promise<RcodeAuthSession | undefined>
    authLogin?: (details: { identifier: string; password: string }) => Promise<RcodeAuthSession>
    authRegister?: (details: { email: string; username: string; displayName: string; password: string }) => Promise<RcodeAuthSession>
    authLogout?: () => Promise<{ ok: boolean }>
  }
}
