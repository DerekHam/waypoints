import { z } from 'zod'

export const TRANSPORT_MODES = [
  'plane',
  'train',
  'car',
  'bus',
  'ferry',
  'bike',
  'walk',
] as const
export type TransportMode = (typeof TRANSPORT_MODES)[number]

export const JOURNEY_COLORS = [
  'terracotta',
  'indigo',
  'sage',
  'ochre',
  'plum',
  'slate',
] as const
export type JourneyColor = (typeof JOURNEY_COLORS)[number]

export type Locale = 'en' | 'zh'

const isHttpUrl = (value: string) => {
  try {
    const url = new URL(value)
    return url.protocol === 'https:' || url.protocol === 'http:'
  } catch {
    return false
  }
}

const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected YYYY-MM-DD')
  .optional()

const linkSchema = z.object({
  label: z.string().max(80).optional(),
  labelZh: z.string().max(80).optional(),
  url: z.string().max(2000).refine(isHttpUrl, 'Must be an http(s) URL'),
})

const stopSchema = z.object({
  id: z.string().min(1).max(80),
  name: z.string().min(1).max(160),
  nameZh: z.string().max(160).optional(),
  region: z.string().max(160).optional(),
  regionZh: z.string().max(160).optional(),
  country: z.string().max(160).optional(),
  countryZh: z.string().max(160).optional(),
  lat: z.number().min(-90).max(90),
  lon: z.number().min(-180).max(180),
  arrive: isoDate,
  depart: isoDate,
  note: z.string().max(4000).optional(),
  noteZh: z.string().max(4000).optional(),
  links: z.array(linkSchema).max(12).default([]),
})

const routeSchema = z.object({
  provider: z.enum(['openrailrouting', 'osrm', 'great-circle', 'schematic']),
  /** [lon, lat] pairs, simplified for the globe. */
  points: z.array(z.tuple([z.number(), z.number()])).max(2500).optional(),
  distanceKm: z.number().nonnegative().optional(),
  status: z.enum(['routed', 'estimated']).default('estimated'),
  /** Stations chosen for a rail leg, when the provider resolved them. */
  fromStation: z.string().max(160).optional(),
  toStation: z.string().max(160).optional(),
})

const connectionSegmentSchema = z.object({
  mode: z.string().max(40),
  line: z.string().max(120).optional(),
  from: z.string().max(160),
  to: z.string().max(160),
  depart: z.string().max(40),
  arrive: z.string().max(40),
})

const railConnectionSchema = z.object({
  provider: z.literal('transitous'),
  serviceDate: z.string().max(20),
  timezone: z.string().max(80),
  arriveTimezone: z.string().max(80).optional(),
  depart: z.string().max(40),
  arrive: z.string().max(40),
  durationMinutes: z.number().int().nonnegative().optional(),
  transfers: z.number().int().min(0).max(20),
  summary: z.string().max(240),
  segments: z.array(connectionSegmentSchema).max(16).default([]),
  checkedAt: z.string().max(40),
  note: z.string().max(500).optional(),
})

const legSchema = z.object({
  mode: z.enum(TRANSPORT_MODES),
  note: z.string().max(500).optional(),
  noteZh: z.string().max(500).optional(),
  route: routeSchema.nullable().optional(),
  connection: railConnectionSchema.nullable().optional(),
})

const journeySchema = z.object({
  id: z.string().min(1).max(80),
  title: z.string().min(1).max(160),
  titleZh: z.string().max(160).optional(),
  subtitle: z.string().max(240).optional(),
  subtitleZh: z.string().max(240).optional(),
  note: z.string().max(4000).optional(),
  noteZh: z.string().max(4000).optional(),
  color: z.enum(JOURNEY_COLORS),
  stops: z.array(stopSchema).max(80),
  legs: z.array(legSchema).max(80),
  createdAt: z.string().max(40),
  updatedAt: z.string().max(40),
})

export const atlasSchema = z
  .object({
    version: z.literal(1),
    updatedAt: z.string().max(40),
    lastEditedBy: z.string().max(80).optional(),
    journeys: z.array(journeySchema).max(24),
  })
  .superRefine((atlas, ctx) => {
    const journeyIds = new Set<string>()
    const stopIds = new Set<string>()
    for (const journey of atlas.journeys) {
      if (journeyIds.has(journey.id)) {
        ctx.addIssue({
          code: 'custom',
          message: `Duplicate journey id: ${journey.id}`,
          path: ['journeys'],
        })
      }
      journeyIds.add(journey.id)
      if (journey.legs.length !== Math.max(0, journey.stops.length - 1)) {
        ctx.addIssue({
          code: 'custom',
          message: `Journey "${journey.title}" needs exactly ${Math.max(0, journey.stops.length - 1)} legs`,
          path: ['journeys'],
        })
      }
      for (const stop of journey.stops) {
        if (stopIds.has(stop.id)) {
          ctx.addIssue({
            code: 'custom',
            message: `Duplicate stop id: ${stop.id}`,
            path: ['journeys'],
          })
        }
        stopIds.add(stop.id)
        if (stop.arrive && stop.depart && stop.arrive > stop.depart) {
          ctx.addIssue({
            code: 'custom',
            message: `Stop "${stop.name}" departs before it arrives`,
            path: ['journeys'],
          })
        }
      }
    }
  })

export type Atlas = z.infer<typeof atlasSchema>
export type Journey = z.infer<typeof journeySchema>
export type Stop = z.infer<typeof stopSchema>
export type Leg = z.infer<typeof legSchema>
export type RouteGeometry = z.infer<typeof routeSchema>
export type RailConnection = z.infer<typeof railConnectionSchema>
export type Link = z.infer<typeof linkSchema>

export const transportModes = TRANSPORT_MODES
export const journeyColors = JOURNEY_COLORS

export function pick(locale: Locale, english?: string, chinese?: string): string {
  if (locale === 'zh' && chinese && chinese.trim()) return chinese
  return english ?? ''
}

export function stopName(stop: Stop, locale: Locale): string {
  return pick(locale, stop.name, stop.nameZh) || stop.name
}

export function journeyTitle(journey: Journey, locale: Locale): string {
  return pick(locale, journey.title, journey.titleZh) || journey.title
}

export function journeySubtitle(journey: Journey, locale: Locale): string {
  return pick(locale, journey.subtitle, journey.subtitleZh)
}

export function journeyNote(journey: Journey, locale: Locale): string {
  return pick(locale, journey.note, journey.noteZh)
}

export function stopPlace(stop: Stop, locale: Locale): string {
  return [pick(locale, stop.region, stop.regionZh), pick(locale, stop.country, stop.countryZh)]
    .filter(Boolean)
    .join(', ')
}

export function stopNote(stop: Stop, locale: Locale): string {
  return pick(locale, stop.note, stop.noteZh)
}

export function linkLabel(link: Link, locale: Locale): string {
  return pick(locale, link.label, link.labelZh) || new URL(link.url).hostname.replace(/^www\./, '')
}

export function makeId(prefix = 'id'): string {
  const random = Math.random().toString(36).slice(2, 8)
  return `${prefix}-${Date.now().toString(36)}-${random}`
}

export function createLeg(mode: TransportMode = 'train'): Leg {
  return { mode, route: null, connection: null }
}

export function emptyLegs(count: number): Leg[] {
  return Array.from({ length: Math.max(0, count) }, () => createLeg())
}

/** Validate and normalise data loaded from disk or the relay. */
export function parseAtlas(input: unknown): Atlas {
  return atlasSchema.parse(input)
}

export function safeParseAtlas(input: unknown) {
  return atlasSchema.safeParse(input)
}
