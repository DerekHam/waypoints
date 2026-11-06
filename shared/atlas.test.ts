import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { atlasSchema, type Atlas } from './atlas'

const atlasUrl = new URL('../public/data/atlas.json', import.meta.url)

async function sample(): Promise<Atlas> {
  return JSON.parse(await readFile(atlasUrl, 'utf8')) as Atlas
}

describe('atlas schema', () => {
  it('accepts the bundled atlas', async () => {
    const result = atlasSchema.safeParse(await sample())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.journeys.length).toBeGreaterThan(0)
      for (const journey of result.data.journeys) {
        expect(journey.legs.length).toBe(Math.max(0, journey.stops.length - 1))
      }
    }
  })

  it('rejects a journey whose leg count does not match its stops', async () => {
    const data = await sample()
    data.journeys[0].legs.pop()
    const result = atlasSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('rejects invalid coordinates', async () => {
    const data = await sample()
    data.journeys[0].stops[0].lat = 120
    const result = atlasSchema.safeParse(data)
    expect(result.success).toBe(false)
  })

  it('accepts bilingual content', async () => {
    const data = await sample()
    const journey = data.journeys[0]
    journey.titleZh = '毕业旅行'
    journey.stops[0].nameZh = '北京'
    journey.stops[0].noteZh = '从北京出发的慢车。'
    const result = atlasSchema.safeParse(data)
    expect(result.success).toBe(true)
  })
})
