import sharp from 'sharp'
import { promises as fs } from 'fs'
import path from 'path'

const SRC = 'assets/T.png'
const RES = 'android/app/src/main/res'
const WHITE = { r: 255, g: 255, b: 255, alpha: 1 }

const legacy = { 'mdpi': 48, 'hdpi': 72, 'xhdpi': 96, 'xxhdpi': 144, 'xxxhdpi': 192 }
const adaptive = { 'mdpi': 108, 'hdpi': 162, 'xhdpi': 216, 'xxhdpi': 324, 'xxxhdpi': 432 }

const { width: W, height: H } = await sharp(SRC).metadata()

// 1) Remove the three grey badge bubbles (pencil top, bus left, share bottom),
//    leaving just the T with the orange route, pin and arrow.
const rect = async (fx0, fy0, fx1, fy1) => ({
  input: await sharp({ create: { width: Math.round(W * (fx1 - fx0)), height: Math.round(H * (fy1 - fy0)), channels: 4, background: WHITE } }).png().toBuffer(),
  left: Math.round(W * fx0),
  top: Math.round(H * fy0),
})
const badges = [
  await rect(0.43, 0.02, 0.66, 0.235), // pencil (top-centre)
  await rect(0.09, 0.34, 0.30, 0.53),  // bus (left)
  await rect(0.42, 0.72, 0.66, 0.94),  // share (bottom-centre)
]
const cleaned = await sharp(SRC).composite(badges).png().toBuffer()

// 2) Trim surrounding white to a tight bounding box of the mark.
let mark
try {
  mark = await sharp(cleaned).trim({ background: '#ffffff', threshold: 8 }).png().toBuffer()
} catch {
  mark = cleaned
}

async function square(size, frac) {
  const box = Math.round(size * frac)
  const inner = await sharp(mark)
    .resize({ width: box, height: box, fit: 'inside', background: { r: 255, g: 255, b: 255, alpha: 0 } })
    .toBuffer()
  const m = await sharp(inner).metadata()
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } })
    .composite([{ input: inner, left: Math.round((size - m.width) / 2), top: Math.round((size - m.height) / 2) }])
    .png()
    .toBuffer()
}

async function circle(buf, size) {
  const mask = Buffer.from(`<svg width="${size}" height="${size}"><circle cx="${size / 2}" cy="${size / 2}" r="${size / 2}" fill="#fff"/></svg>`)
  return sharp(buf).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer()
}

async function solid(size) {
  return sharp({ create: { width: size, height: size, channels: 4, background: WHITE } }).png().toBuffer()
}

for (const [d, lsize] of Object.entries(legacy)) {
  const asize = adaptive[d]
  const dir = path.join(RES, `mipmap-${d}`)
  const sq = await square(lsize, 0.82)
  await fs.writeFile(path.join(dir, 'ic_launcher.png'), sq)
  await fs.writeFile(path.join(dir, 'ic_launcher_round.png'), await circle(sq, lsize))
  await fs.writeFile(path.join(dir, 'ic_launcher_foreground.png'), await square(asize, 0.66))
  await fs.writeFile(path.join(dir, 'ic_launcher_background.png'), await solid(asize))
  console.log(`mipmap-${d}: legacy ${lsize}, adaptive ${asize}`)
}

await fs.writeFile('public/trackpi-icon-192.png', await square(192, 0.86))
await fs.writeFile('public/trackpi-icon-512.png', await square(512, 0.86))

// Composed previews for a visual check (adaptive foreground on white, and round).
await sharp({ create: { width: 432, height: 432, channels: 4, background: WHITE } })
  .composite([{ input: await square(432, 0.66) }]).png().toFile('scripts/_icon_preview.png')
await sharp(await circle(await square(432, 0.82), 432)).png().toFile('scripts/_icon_round_preview.png')

console.log('done')
