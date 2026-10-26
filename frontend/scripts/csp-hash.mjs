// Prints CSP sha256 sources for inline <script> blocks in the built index.html.
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const file = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist', 'index.html')
const html = readFileSync(file, 'utf8')
const inline = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)]

for (const [, body] of inline) {
  console.log(`'sha256-${createHash('sha256').update(body, 'utf8').digest('base64')}'`)
}
