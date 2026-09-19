export const EVENT_COLORS = ['#E86F51', '#238C82', '#F2A65A', '#4D73BE', '#9A5A78'] as const

export function normalizeEventColor(value: string | undefined) {
  const color = value?.trim()
  if (!color) return EVENT_COLORS[0]

  const hex = color.replace(/^#|^0x/i, '')
  if (/^[0-9a-f]{8}$/i.test(hex)) return `#${hex.slice(2)}`
  if (/^[0-9a-f]{6}$/i.test(hex)) return color.startsWith('#') ? color : `#${hex}`

  if (/^-?\d+$/.test(color)) {
    const argb = Number(color) >>> 0
    return `#${argb.toString(16).padStart(8, '0').slice(2).toUpperCase()}`
  }

  return color
}
