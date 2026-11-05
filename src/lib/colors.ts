import type { JourneyColor } from '@shared/atlas'

export const JOURNEY_HEX: Record<JourneyColor, string> = {
  terracotta: '#a95f45',
  indigo: '#4f5d75',
  sage: '#6f7b5f',
  ochre: '#b38a4e',
  plum: '#7c5464',
  slate: '#5c6870',
}

export const JOURNEY_SOFT: Record<JourneyColor, string> = {
  terracotta: 'rgba(169, 95, 69, 0.16)',
  indigo: 'rgba(79, 93, 117, 0.16)',
  sage: 'rgba(111, 123, 95, 0.16)',
  ochre: 'rgba(179, 138, 78, 0.16)',
  plum: 'rgba(124, 84, 100, 0.16)',
  slate: 'rgba(92, 104, 112, 0.16)',
}

export function journeyColor(color: JourneyColor): string {
  return JOURNEY_HEX[color] ?? JOURNEY_HEX.terracotta
}
