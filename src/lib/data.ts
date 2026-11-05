import { parseAtlas, type Atlas } from '@shared/atlas'
import { siteConfig } from '@/config'

export async function loadPublicAtlas(): Promise<Atlas> {
  const base = import.meta.env.BASE_URL || './'
  const url = new URL(`${base.replace(/\/$/, '')}/${siteConfig.dataFile}`, document.baseURI)
  url.searchParams.set('v', String(Date.now()))
  const response = await fetch(url, { cache: 'no-store' })
  if (!response.ok) throw new Error(`Could not load the atlas (${response.status})`)
  const raw = await response.json()
  return parseAtlas(raw)
}

export type UrlSelection = {
  journeyId: string | null
  stopId: string | null
}

export function readUrlSelection(): UrlSelection {
  const params = new URLSearchParams(window.location.search)
  return {
    journeyId: params.get('j'),
    stopId: params.get('s'),
  }
}

export function writeUrlSelection(journeyId: string | null, stopId: string | null): void {
  const url = new URL(window.location.href)
  if (journeyId) url.searchParams.set('j', journeyId)
  else url.searchParams.delete('j')
  if (stopId) url.searchParams.set('s', stopId)
  else url.searchParams.delete('s')
  const next = `${url.pathname}${url.search}${url.hash}`
  window.history.replaceState(null, '', next)
}
