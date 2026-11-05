import { describe, expect, it } from 'vitest'
import {
  formatDateRange,
  formatDistance,
  haversineKm,
  timezoneFor,
  zonedIso,
} from './geo'

describe('geo helpers', () => {
  it('measures the Shanghai–Suzhou direct distance approximately', () => {
    const km = haversineKm([121.4737, 31.2304], [120.5853, 31.2989])
    expect(km).toBeGreaterThan(80)
    expect(km).toBeLessThan(95)
  })

  it('formats distances in both languages', () => {
    expect(formatDistance(4283.2, 'en')).toBe('4,283 km')
    expect(formatDistance(4283.2, 'zh')).toBe('4,283 公里')
  })

  it('formats a compact Chinese date range', () => {
    expect(formatDateRange('2027-04-03', '2027-04-26', 'zh')).toBe('2027年4月3–26日')
  })

  it('formats an English date range', () => {
    expect(formatDateRange('2027-04-03', '2027-04-26', 'en')).toBe('3 Apr – 26 Apr, 2027')
  })

  it('builds a zoned ISO time with the right offset', () => {
    expect(zonedIso('2026-11-12', '09:00', 'Asia/Tokyo')).toBe('2026-11-12T09:00:00+09:00')
  })

  it('looks up a timezone from coordinates', () => {
    expect(timezoneFor(31.2304, 121.4737)).toBe('Asia/Shanghai')
  })
})
