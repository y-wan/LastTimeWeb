type Rgb = [number, number, number]

function parseHex(color: string): Rgb | undefined {
  const hex = color.trim().replace(/^#/, '')
  const rgb = hex.length === 8 ? hex.slice(2) : hex
  if (!/^[0-9a-f]{6}$/i.test(rgb)) return undefined
  return [0, 2, 4].map((index) => Number.parseInt(rgb.slice(index, index + 2), 16)) as Rgb
}

function channelLuminance(channel: number) {
  const value = channel / 255
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4
}

function luminance(rgb: Rgb) {
  return 0.2126 * channelLuminance(rgb[0]) + 0.7152 * channelLuminance(rgb[1]) + 0.0722 * channelLuminance(rgb[2])
}

export function contrastRatio(first: string, second: string) {
  const firstRgb = parseHex(first)
  const secondRgb = parseHex(second)
  if (!firstRgb || !secondRgb) return 1
  const [lighter, darker] = [luminance(firstRgb), luminance(secondRgb)].sort((a, b) => b - a)
  return (lighter + 0.05) / (darker + 0.05)
}

function toHex(rgb: Rgb) {
  return `#${rgb.map((channel) => Math.round(channel).toString(16).padStart(2, '0')).join('').toUpperCase()}`
}

export function accessibleForeground(color: string, surface: string, target = 4.5) {
  const source = parseHex(color)
  const background = parseHex(surface)
  if (!source || !background || contrastRatio(color, surface) >= target) return color

  const endpoint: Rgb = luminance(background) > 0.5 ? [0, 0, 0] : [255, 255, 255]
  let low = 0
  let high = 1
  for (let iteration = 0; iteration < 20; iteration++) {
    const mix = (low + high) / 2
    const candidate = source.map((channel, index) => channel + (endpoint[index] - channel) * mix) as Rgb
    if (contrastRatio(toHex(candidate), surface) >= target) high = mix
    else low = mix
  }
  return toHex(source.map((channel, index) => channel + (endpoint[index] - channel) * high) as Rgb)
}
