/**
 * Build a sepia MapLibre style from OpenFreeMap's Positron style.
 *
 * OpenFreeMap provides free, keyless OpenMapTiles vector tiles with
 * attribution. Terrain comes from the AWS Open Data Mapzen terrarium tiles.
 *
 * Usage: npm run map:style
 */
import { writeFile } from 'node:fs/promises'

const SOURCE_STYLE = 'https://tiles.openfreemap.org/styles/positron'
const OUTPUT = new URL('../public/map-style.json', import.meta.url)

const style = await fetch(SOURCE_STYLE).then((response) => {
  if (!response.ok) throw new Error(`Could not fetch the style: ${response.status}`)
  return response.json()
})

style.name = 'Waypoints'
style.projection = { type: 'globe' }
style.sky = {
  'atmosphere-blend': 0,
}
style.light = { anchor: 'map', position: [1.5, 90, 80] }

delete style.sources.ne2_shaded
const terrainSource = {
  type: 'raster-dem',
  url: 'https://tiles.mapterhorn.com/tilejson.json',
  tileSize: 512,
  encoding: 'terrarium',
  minzoom: 4,
  attribution: 'Terrain: <a href="https://mapterhorn.com/attribution">Mapterhorn</a>',
}
style.sources.terrain = terrainSource
style.sources.hillshade = terrainSource
style.terrain = { source: 'terrain', exaggeration: 0.7 }

const layers = style.layers
const byId = new Map(layers.map((layer) => [layer.id, layer]))

function paint(id, values) {
  const layer = byId.get(id)
  if (!layer) return
  layer.paint = { ...(layer.paint ?? {}), ...values }
}

function hide(id) {
  const layer = byId.get(id)
  if (!layer) return
  layer.layout = { ...(layer.layout ?? {}), visibility: 'none' }
}

function label(id, color = '#3b3327', halo = '#efe6d3') {
  paint(id, { 'text-color': color, 'text-halo-color': halo, 'text-halo-width': 1.2 })
}

paint('background', { 'background-color': '#ece2cd' })
paint('park', { 'fill-color': '#d9ccaa', 'fill-opacity': 0.5 })
paint('water', { 'fill-color': '#e5dfcf' })
paint('landcover_ice_shelf', { 'fill-color': '#f0e8d6', 'fill-opacity': 0.7 })
paint('landcover_glacier', { 'fill-color': '#f0e8d6', 'fill-opacity': 0.6 })
paint('landuse_residential', { 'fill-color': '#d9c8a4', 'fill-opacity': 0.36 })
paint('landcover_wood', { 'fill-color': '#cbbb97', 'fill-opacity': 0.45 })
paint('waterway', { 'line-color': '#b7b29a' })
hide('building')

paint('tunnel_motorway_casing', { 'line-color': '#c2ae8a' })
paint('tunnel_motorway_inner', { 'line-color': '#f2e9d5' })
paint('aeroway-taxiway', { 'line-color': '#d9cbb0' })
paint('aeroway-runway-casing', { 'line-color': '#cdbb9b' })
paint('aeroway-area', { 'fill-color': '#e5dbc6' })
paint('aeroway-runway', { 'line-color': '#f4ecd9' })
hide('airport')
hide('aeroway-taxiway')
hide('aeroway-runway-casing')
hide('aeroway-area')
hide('aeroway-runway')
paint('road_area_pier', { 'fill-color': '#e5dfcf' })
paint('road_pier', { 'line-color': '#d4c19d' })
paint('highway_path', { 'line-color': '#d7c6a6', 'line-opacity': 0.75 })
paint('highway_minor', { 'line-color': '#cbb58f', 'line-opacity': 0.8 })
paint('highway_major_casing', { 'line-color': '#bfa77f' })
paint('highway_major_inner', { 'line-color': '#f3ead6' })
paint('highway_major_subtle', { 'line-color': '#d4c19f', 'line-opacity': 0.6 })
paint('highway_motorway_casing', { 'line-color': '#b19065' })
paint('highway_motorway_inner', { 'line-color': '#f7efdc' })
paint('highway_motorway_subtle', { 'line-color': '#cdb38d', 'line-opacity': 0.6 })
paint('highway_motorway_bridge_casing', { 'line-color': '#b19065' })
paint('highway_motorway_bridge_inner', { 'line-color': '#f7efdc' })
paint('railway_transit', { 'line-color': '#a7957b' })
paint('railway_transit_dashline', { 'line-color': '#efe6d3' })
paint('railway_service', { 'line-color': '#a7957b' })
paint('railway_service_dashline', { 'line-color': '#efe6d3' })
paint('railway', { 'line-color': '#8e7b63' })
paint('railway_dashline', { 'line-color': '#efe6d3' })

paint('boundary_3', { 'line-color': '#806b51', 'line-opacity': 0.26 })
paint('boundary_2', { 'line-color': '#5f4d3a', 'line-opacity': 0.34 })
paint('boundary_disputed', { 'line-color': '#9b5c49', 'line-opacity': 0.5 })

for (const id of [
  'waterway_line_label',
  'water_name_point_label',
  'water_name_line_label',
]) {
  label(id, '#6d8079', '#e9e2d1')
}
for (const id of ['highway-name-path', 'highway-name-minor', 'highway-name-major']) {
  label(id, '#7d6b52', '#efe6d3')
}
for (const id of [
  'label_other',
  'label_village',
  'label_town',
  'label_state',
  'label_city',
  'label_city_capital',
  'label_country_3',
  'label_country_2',
  'label_country_1',
]) {
  label(id)
}
hide('road_shield_us')
hide('highway-shield-us-interstate')
hide('highway-shield-non-us')

const backgroundIndex = layers.findIndex((layer) => layer.id === 'background')
layers.splice(backgroundIndex + 1, 0, {
  id: 'terrain-hillshade',
  type: 'hillshade',
  source: 'hillshade',
  minzoom: 0,
  maxzoom: 16,
  paint: {
    'hillshade-shadow-color': '#71593d',
    'hillshade-highlight-color': '#f8f0de',
    'hillshade-accent-color': '#b59a74',
    'hillshade-exaggeration': 0.38,
  },
})

await writeFile(OUTPUT, `${JSON.stringify(style, null, 2)}\n`)
console.log(`Wrote ${OUTPUT.pathname} (${layers.length} layers)`)
