import { readFile } from 'node:fs/promises'
import { describe, expect, it } from 'vitest'
import { atlasSchema, type Atlas } from './atlas'

const atlasUrl = new URL('../public/data/atlas.json', import.meta.url)

async function sample(): Promise<Atlas> {
  return JSON.parse(await readFile(atlasUrl, 'utf8')) as Atlas
}

describe('atlas schema', () => {
  it('accepts the bundled sample atlas', async () => {
    const result = atlasSchema.safeParse(await sample())
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.journeys).toHaveLength(1)
      expect(result.data.journeys[0].stops.length).toBe(9)
      expect(result.data.journeys[0].legs.length).toBe(8)
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
    expect(data.journeys[0].titleZh).toBe('江南与蜀道')
    expect(data.journeys[0].stops[0].nameZh).toBe('上海')
    expect(data.journeys[0].stops[0].noteZh).toContain('法租界')
  })
})
