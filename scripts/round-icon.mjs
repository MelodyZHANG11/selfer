import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { PNG } from 'pngjs'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(__dirname, '..')
const src = path.join(root, 'build', 'icon-source.png')
const dst = path.join(root, 'build', 'icon.png')

const input = PNG.sync.read(fs.readFileSync(src))
const { width, height } = input

// macOS Big Sur+ icon corner radius (squircle approx) ≈ 22.37% of width.
const radius = Math.round(Math.min(width, height) * 0.2237)

// Output is RGBA. pngjs always lays out 4 bytes per pixel; if the source has
// no alpha, its A channel is already 0xFF after read.
const output = new PNG({ width, height })

// Antialiased rounded-rect mask. A pixel is only on a corner arc when it's
// inside both an x-corner band AND a y-corner band; otherwise it's on a
// straight edge or the interior and stays fully opaque.
function cornerAlpha(x, y) {
  const inCornerX = x < radius || x >= width - radius
  const inCornerY = y < radius || y >= height - radius
  if (!inCornerX || !inCornerY) return 255
  const cx = x < radius ? radius : width - radius - 1
  const cy = y < radius ? radius : height - radius - 1
  const dx = x - cx
  const dy = y - cy
  const d = Math.sqrt(dx * dx + dy * dy)
  if (d <= radius - 0.5) return 255
  if (d >= radius + 0.5) return 0
  return Math.round((radius + 0.5 - d) * 255)
}

for (let y = 0; y < height; y++) {
  for (let x = 0; x < width; x++) {
    const i = (y * width + x) * 4
    output.data[i] = input.data[i]
    output.data[i + 1] = input.data[i + 1]
    output.data[i + 2] = input.data[i + 2]
    const srcA = input.data[i + 3]
    output.data[i + 3] = Math.round((srcA * cornerAlpha(x, y)) / 255)
  }
}

fs.writeFileSync(dst, PNG.sync.write(output))
console.log(`wrote ${dst} (${width}x${height}, radius=${radius}px)`)
