#!/usr/bin/env node
/**
 * 根据一张方形源图生成 Rcode 桌面端 + Android 端所需的全部图标资源。
 *
 * 用法：
 *   node scripts/generate-rcode-icons.mjs <source.png>
 *
 * 未指定 source 时默认使用 /Users/a1412/Downloads/Image.png。
 */
import sharp from 'sharp'
import { writeFileSync, mkdirSync, copyFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'

const __dirname = dirname(fileURLToPath(import.meta.url))
const PROJECT_ROOT = dirname(__dirname)
const SRC = process.argv[2] || '/Users/a1412/Downloads/Image.png'

const BG = '#0f172a' // slate-900, consistent with current Rcode dark theme
const WATERMARK_W = 140
const WATERMARK_H = 60
const ICON_SCALE = 0.68

/**
 * 把源图处理成「白色线稿 + 透明背景」的 PNG。
 * 原图是黑线白底，通过灰度->阈值->反色得到 alpha 蒙版。
 */
async function extractWhiteIcon(size) {
  const watermark = Buffer.from(
    `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${WATERMARK_W}" height="${WATERMARK_H}" fill="white"/></svg>`
  )

  const mask = await sharp(SRC)
    .resize(size, size, { fit: 'fill' })
    .composite([{ input: watermark, top: 0, left: 0 }])
    .greyscale()
    .threshold(128)
    .negate()
    .raw()
    .toBuffer()

  const rgba = Buffer.alloc(size * size * 4)
  for (let i = 0; i < size * size; i++) {
    rgba[i * 4] = 255
    rgba[i * 4 + 1] = 255
    rgba[i * 4 + 2] = 255
    rgba[i * 4 + 3] = mask[i]
  }

  return sharp(rgba, { raw: { width: size, height: size, channels: 4 } }).png().toBuffer()
}

async function createIcon(size, { rounded = false, circle = false, iconScale = ICON_SCALE, bg = BG } = {}) {
  const whiteIcon = await extractWhiteIcon(1024)
  const iconPixelSize = Math.round(size * iconScale)
  const resizedIcon = await sharp(whiteIcon)
    .resize(iconPixelSize, iconPixelSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const offset = Math.round((size - iconPixelSize) / 2)

  let backgroundSvg
  if (circle) {
    backgroundSvg = `<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="${bg}"/></svg>`
  } else if (rounded) {
    const r = Math.round(size * 0.225)
    backgroundSvg = `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" rx="${r}" ry="${r}" fill="${bg}"/></svg>`
  } else {
    backgroundSvg = `<svg width="${size}" height="${size}"><rect x="0" y="0" width="${size}" height="${size}" fill="${bg}"/></svg>`
  }

  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([
      { input: Buffer.from(backgroundSvg) },
      { input: resizedIcon, top: offset, left: offset }
    ])
    .png()
    .toBuffer()
}

async function createAndroidForeground(size, iconScale = 0.66) {
  const whiteIcon = await extractWhiteIcon(1024)
  const iconPixelSize = Math.round(size * iconScale)
  const resized = await sharp(whiteIcon)
    .resize(iconPixelSize, iconPixelSize, { fit: 'contain', background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer()

  const offset = Math.round((size - iconPixelSize) / 2)
  return sharp({
    create: { width: size, height: size, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } }
  })
    .composite([{ input: resized, top: offset, left: offset }])
    .png()
    .toBuffer()
}

async function main() {
  console.log('Generating icons from', SRC)

  // Desktop app icons
  const rcodePng = await createIcon(1024, { rounded: false })
  const rcodeMacPng = await createIcon(1024, { rounded: true })
  const trayPng = await createIcon(128, { rounded: true, iconScale: 0.72 })

  writeFileSync(join(PROJECT_ROOT, 'src/asset/img/Rcode.png'), rcodePng)
  writeFileSync(join(PROJECT_ROOT, 'src/asset/img/Rcode_mac.png'), rcodeMacPng)
  writeFileSync(join(PROJECT_ROOT, 'src/asset/img/Rcode_tray.png'), trayPng)
  console.log('Wrote src/asset/img/Rcode.png, Rcode_mac.png, Rcode_tray.png')

  // Windows ICO
  const iconIcoPath = join(PROJECT_ROOT, 'build/icon.ico')
  try {
    execFileSync(
      'npx',
      ['--yes', 'png2icons@2.0.1', join(PROJECT_ROOT, 'src/asset/img/Rcode_mac.png'), join(PROJECT_ROOT, 'build/icon'), '-icowe', '-bc'],
      { stdio: 'inherit' }
    )
    console.log('Wrote build/icon.ico')
  } catch (e) {
    console.error('Failed to generate ICO. Make sure png2icons is available or install it manually.')
    throw e
  }

  // Android icons
  const androidDensities = [
    { name: 'mdpi', legacy: 48, foreground: 108 },
    { name: 'hdpi', legacy: 72, foreground: 162 },
    { name: 'xhdpi', legacy: 96, foreground: 216 },
    { name: 'xxhdpi', legacy: 144, foreground: 324 },
    { name: 'xxxhdpi', legacy: 192, foreground: 432 }
  ]

  for (const d of androidDensities) {
    const dir = join(PROJECT_ROOT, 'Rcode_apk/android/app/src/main/res', `mipmap-${d.name}`)
    mkdirSync(dir, { recursive: true })

    const legacy = await createIcon(d.legacy, { rounded: true, iconScale: 0.72 })
    const round = await createIcon(d.legacy, { circle: true, iconScale: 0.66 })
    const foreground = await createAndroidForeground(d.foreground, 0.66)

    writeFileSync(join(dir, 'ic_launcher.png'), legacy)
    writeFileSync(join(dir, 'ic_launcher_round.png'), round)
    writeFileSync(join(dir, 'ic_launcher_foreground.png'), foreground)
  }
  console.log('Wrote Android mipmap resources')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
