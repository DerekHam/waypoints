import { describe, expect, it } from 'vitest'
import {
  rankStationPairs,
  rankStations,
  type Station,
} from '../worker/src/stations'

const beijing: Station[] = [
  { name: '北京', lat: 39.901, lon: 116.421 },
  { name: '北京南', lat: 39.864, lon: 116.373 },
  { name: '北京西', lat: 39.894, lon: 116.315 },
  { name: '北京北', lat: 39.946, lon: 116.346 },
  { name: '北京朝阳', lat: 39.94, lon: 116.5 },
  { name: '北京丰台', lat: 39.85, lon: 116.3 },
  { name: '北京大兴', lat: 39.719, lon: 116.322 },
]

const shanghai: Station[] = [
  { name: '上海', lat: 31.249, lon: 121.455 },
  { name: '上海虹桥', lat: 31.2, lon: 121.32 },
  { name: '上海南', lat: 31.155, lon: 121.429 },
  { name: '上海西', lat: 31.263, lon: 121.401 },
]

const harbin: Station[] = [
  { name: '哈尔滨', lat: 45.76, lon: 126.632 },
  { name: '哈尔滨西', lat: 45.705, lon: 126.573 },
  { name: '哈尔滨东', lat: 45.79, lon: 126.71 },
  { name: '哈尔滨北', lat: 45.85, lon: 126.53 },
]

const xian: Station[] = [
  { name: '西安', lat: 34.28, lon: 108.96 },
  { name: '西安北', lat: 34.376, lon: 108.93 },
  { name: '西安南', lat: 34.12, lon: 108.81 },
]

const beijingCentre = { lat: 39.904, lon: 116.407, name: 'Beijing', nameZh: '北京' }
const shanghaiCentre = { lat: 31.23, lon: 121.474, name: 'Shanghai', nameZh: '上海' }
const harbinCentre = { lat: 45.76, lon: 126.63, name: 'Harbin', nameZh: '哈尔滨' }
const xianCentre = { lat: 34.342, lon: 108.94, name: "Xi'an", nameZh: '西安' }

function departures(
  origins: Station[],
  destinations: Station[],
  from: typeof beijingCentre,
  to: typeof beijingCentre,
): string[] {
  return rankStationPairs(origins, destinations, from, to, {
    fromCount: 4,
    toCount: 1,
  }).map((pair) => pair.from.name)
}

describe('station selection', () => {
  it('keeps nearby stations and drops unrelated places with a similar name', () => {
    const candidates: Station[] = [
      ...beijing,
      { name: '北京路', lat: 23.122, lon: 113.265 },
    ]
    const ranked = rankStations(candidates, beijingCentre)
    expect(ranked[0].name).toBe('北京')
    expect(ranked.map((station) => station.name)).not.toContain('北京路')
  })

  it('tests the south station for a journey to Shanghai', () => {
    expect(departures(beijing, shanghai, beijingCentre, shanghaiCentre)).toContain('北京南')
  })

  it('tests the north-east station for a journey to Harbin', () => {
    expect(departures(beijing, harbin, beijingCentre, harbinCentre)).toContain('北京朝阳')
  })

  it("tests a western station for a journey to Xi'an", () => {
    const names = departures(beijing, xian, beijingCentre, xianCentre)
    expect(names.some((name) => name === '北京西' || name === '北京丰台')).toBe(true)
  })

  it('always tests the central station', () => {
    expect(departures(beijing, harbin, beijingCentre, harbinCentre)).toContain('北京')
  })

  it('pairs every tested departure with the nearest arrival station', () => {
    const pairs = rankStationPairs(beijing, shanghai, beijingCentre, shanghaiCentre, {
      fromCount: 4,
      toCount: 1,
    })
    expect(pairs).toHaveLength(4)
    expect(new Set(pairs.map((pair) => pair.to.name))).toEqual(new Set(['上海']))
  })
})
