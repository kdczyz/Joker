#!/usr/bin/env node
/**
 * Replace app icons from a source image (no white-icon extraction).
 * Generates: Joker.png, Joker_mac.png (rounded), Joker_tray.png (small rounded).
 */
import sharp from 'sharp'
import { writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = dirname(__dirname)
const SRC = process.argv[2]

if (!SRC) {
  console.error('Usage: node scripts/replace-icon.mjs <source.png>')
  process.exit(1)
}

const RADIUS_RATIO = 0.225

async function main() {
  console.log('Replacing icons from', SRC)

  // 1. Joker.png — 1024×1024, no rounding (Linux & general use)
  await sharp(SRC)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toFile(join(PROJECT_ROOT, 'src/asset/img/Joker.png'))
  console.log('✓ Joker.png (1024×1024)')

  // 2. Joker_mac.png — 1024×1024, macOS-style rounded corners
  const icon1024Buf = await sharp(SRC)
    .resize(1024, 1024, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const r1024 = Math.round(1024 * RADIUS_RATIO)
  const maskSvg1024 = Buffer.from(
    `<svg width="1024" height="1024">` +
    `<rect x="0" y="0" width="1024" height="1024" rx="${r1024}" ry="${r1024}" fill="white"/>` +
    `</svg>`
  )
  await sharp({ create: { width: 1024, height: 1024, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: maskSvg1024 },
      { input: icon1024Buf, blend: 'dest-in' }
    ])
    .png()
    .toFile(join(PROJECT_ROOT, 'src/asset/img/Joker_mac.png'))
  console.log('✓ Joker_mac.png (1024×1024, rounded)')

  // 3. Joker_tray.png — 128×128, rounded (system tray)
  const icon128Buf = await sharp(SRC)
    .resize(128, 128, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const r128 = Math.round(128 * RADIUS_RATIO)
  const maskSvg128 = Buffer.from(
    `<svg width="128" height="128">` +
    `<rect x="0" y="0" width="128" height="128" rx="${r128}" ry="${r128}" fill="white"/>` +
    `</svg>`
  )
  await sharp({ create: { width: 128, height: 128, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([
      { input: maskSvg128 },
      { input: icon128Buf, blend: 'dest-in' }
    ])
    .png()
    .toFile(join(PROJECT_ROOT, 'src/asset/img/Joker_tray.png'))
  console.log('✓ Joker_tray.png (128×128, rounded)')

  console.log('\nDone! All icon files replaced.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
