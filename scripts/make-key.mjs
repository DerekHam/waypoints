import { createHash, randomBytes } from 'node:crypto'
import { createInterface } from 'node:readline/promises'

function usage() {
  console.log('')
  console.log('  Usage:')
  console.log('    npm run keygen -- "Derek"')
  console.log('    npm run keygen -- --name "Derek" --key "a long custom passphrase"')
  console.log('    npm run keygen -- --name "Derek" --key-stdin')
  console.log('')
  console.log('  --name, -n        Editor display name (default: Editor)')
  console.log('  --key, -k         A custom key instead of a random one')
  console.log('  --key-stdin, -s   Prompt for the custom key (keeps it out of shell history)')
  console.log('')
  console.log('  A custom key should be long: 4+ random words or 20+ characters.')
  console.log('')
}

const args = process.argv.slice(2)
let name = ''
let customKey = ''
let promptForKey = false
const positional = []

for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--help' || arg === '-h') {
    usage()
    process.exit(0)
  } else if (arg === '--name' || arg === '-n') {
    name = (args[index + 1] ?? '').trim()
    index += 1
  } else if (arg.startsWith('--name=')) {
    name = arg.slice('--name='.length).trim()
  } else if (arg === '--key' || arg === '-k') {
    customKey = args[index + 1] ?? ''
    index += 1
  } else if (arg.startsWith('--key=')) {
    customKey = arg.slice('--key='.length)
  } else if (arg === '--key-stdin' || arg === '-s') {
    promptForKey = true
  } else if (arg.startsWith('-')) {
    console.error(`Unknown option: ${arg}`)
    usage()
    process.exit(1)
  } else {
    positional.push(arg)
  }
}

if (!name && positional.length) name = positional.shift() ?? ''
if (!customKey && positional.length) customKey = positional.join(' ')
if (!name) name = 'Editor'
if (promptForKey) {
  const readline = createInterface({ input: process.stdin, output: process.stdout })
  customKey = await readline.question(`Custom access key for ${name}: `)
  readline.close()
}

const usingCustomKey = Boolean(customKey.trim())
const key = usingCustomKey ? customKey.trim() : randomBytes(24).toString('base64url')
const salt = randomBytes(12).toString('hex')
const hash = createHash('sha256').update(`${salt}${key}`).digest('hex')
const entry = { name, salt, hash }

if (usingCustomKey && key.length < 16) {
  console.warn('')
  console.warn('  Warning: that custom key is short. Use at least 16 characters,')
  console.warn('  ideally four or more random words. The Worker rate-limits logins,')
  console.warn('  but a weak key is still the weakest part of the setup.')
}
if (usingCustomKey && /^(password|waypoints|letmein|123456)/i.test(key)) {
  console.warn('')
  console.warn('  Warning: that key looks very easy to guess. Consider a longer passphrase.')
}

console.log('')
console.log(`  Editor: ${name}`)
console.log(`  Key:    ${key}`)
console.log(`  Type:   ${usingCustomKey ? 'custom' : 'randomly generated'}`)
console.log('')
console.log('  Give the key to the editor. Add this object to the EDITOR_KEYS JSON array:')
console.log('')
console.log(`  ${JSON.stringify(entry)}`)
console.log('')
console.log('  A complete array with just this editor would look like:')
console.log('')
console.log(`  [${JSON.stringify(entry)}]`)
console.log('')
console.log('  To replace an existing entry, replace that editor’s object; do not')
console.log('  leave the old one in the array. To revoke an editor, remove their object.')
console.log('')
console.log('  Deploy with: npx wrangler secret put EDITOR_KEYS --config worker/wrangler.toml')
console.log('  (Paste the array, including the square brackets, when prompted.)')
console.log('')
console.log('  Generating a key does not install it. Keep the full array somewhere')
console.log('  safe: Cloudflare never shows a secret again. If you have lost the')
console.log('  current array, put this object in EDITOR_KEYS_EXTRA instead:')
console.log('')
console.log('  npx wrangler secret put EDITOR_KEYS_EXTRA --config worker/wrangler.toml')
console.log('')
