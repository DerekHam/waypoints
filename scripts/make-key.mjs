import { createHash, randomBytes } from 'node:crypto'

const name = process.argv.slice(2).join(' ').trim() || 'Editor'
const key = randomBytes(24).toString('base64url')
const salt = randomBytes(12).toString('hex')
const hash = createHash('sha256').update(`${salt}${key}`).digest('hex')
const entry = { name, salt, hash }

console.log('')
console.log(`  Editor: ${name}`)
console.log(`  Key:    ${key}`)
console.log('')
console.log('  Give the key to the editor. Add this object to the EDITOR_KEYS JSON array:')
console.log('')
console.log(`  ${JSON.stringify(entry)}`)
console.log('')
console.log('  A complete array with just this editor would look like:')
console.log('')
console.log(`  [${JSON.stringify(entry)}]`)
console.log('')
console.log('  Deploy with: npx wrangler secret put EDITOR_KEYS --config worker/wrangler.toml')
console.log('  (Paste the array, including the square brackets, when prompted.)')
console.log('')
