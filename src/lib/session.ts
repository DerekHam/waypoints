import type { Atlas } from '@shared/atlas'

export type SessionMode = 'relay' | 'local'

export type Session = {
  mode: SessionMode
  token?: string
  editor: string
  expiresAt?: string
}

const SESSION_KEY = 'waypoints.session.v1'
const LOCAL_ATLAS_KEY = 'waypoints.local-atlas.v1'

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY)
    if (!raw) return null
    const session = JSON.parse(raw) as Session
    if (!session || (session.mode !== 'relay' && session.mode !== 'local')) return null
    if (session.mode === 'relay') {
      if (!session.token) return null
      if (session.expiresAt && Date.parse(session.expiresAt) < Date.now()) {
        localStorage.removeItem(SESSION_KEY)
        return null
      }
    }
    return session
  } catch {
    return null
  }
}

export function storeSession(session: Session): void {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session))
}

export function clearSession(): void {
  localStorage.removeItem(SESSION_KEY)
}

export function loadLocalAtlas(): Atlas | null {
  try {
    const raw = localStorage.getItem(LOCAL_ATLAS_KEY)
    return raw ? (JSON.parse(raw) as Atlas) : null
  } catch {
    return null
  }
}

export function storeLocalAtlas(atlas: Atlas): void {
  localStorage.setItem(LOCAL_ATLAS_KEY, JSON.stringify(atlas))
}

export function clearLocalAtlas(): void {
  localStorage.removeItem(LOCAL_ATLAS_KEY)
}
