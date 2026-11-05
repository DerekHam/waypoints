import type { Atlas } from '@shared/atlas'

export type Draft = {
  atlas: Atlas
  baseSha: string | null
  savedAt: string
  sessionMode: 'relay' | 'local'
}

const DRAFT_KEY = 'waypoints.draft.v1'

export function loadDraft(): Draft | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY)
    if (!raw) return null
    const draft = JSON.parse(raw) as Draft
    if (!draft?.atlas || !draft.savedAt) return null
    return draft
  } catch {
    return null
  }
}

export function saveDraft(draft: Draft): void {
  try {
    localStorage.setItem(DRAFT_KEY, JSON.stringify(draft))
  } catch {
    // Storage full or unavailable; editing still works for this session.
  }
}

export function clearDraft(): void {
  localStorage.removeItem(DRAFT_KEY)
}
