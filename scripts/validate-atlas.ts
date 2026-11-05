import { readFile } from 'node:fs/promises'
import { atlasSchema } from '../shared/atlas'

const path = new URL('../public/data/atlas.json', import.meta.url)
const raw = JSON.parse(await readFile(path, 'utf8'))
const result = atlasSchema.safeParse(raw)

if (!result.success) {
  console.error('The atlas is invalid:')
  for (const issue of result.error.issues) {
    console.error(`- ${issue.path.join('.')}: ${issue.message}`)
  }
  process.exit(1)
}

const atlas = result.data
const stopCount = atlas.journeys.reduce((total, journey) => total + journey.stops.length, 0)
const routed = atlas.journeys.reduce(
  (total, journey) => total + journey.legs.filter((leg) => leg.route?.points?.length).length,
  0,
)
console.log(
  `Atlas is valid: ${atlas.journeys.length} journey(s), ${stopCount} stop(s), ${routed} routed leg(s).`,
)
