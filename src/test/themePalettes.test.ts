import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { describe, expect, it } from 'vitest'

const css = readFileSync(resolve(process.cwd(), 'src', 'styles.css'), 'utf8').toUpperCase()

const palettes = {
  vitalOrange: ['#E86F51', '#FFDCD2', '#238C82', '#C5F1EA', '#F2A65A', '#FFF8F3', '#F5ECE6', '#D8C8BE', '#FFA38A', '#713024', '#75D8CC', '#155F58', '#FFB86F', '#1D1A18', '#372F2B', '#9F8D83'],
  mistBlue: ['#587DB7', '#DCE7FF', '#4F8997', '#CDECF2', '#8B78A8', '#F7F9FC', '#EDF1F6', '#C8D0DB', '#AEC8FA', '#334E79', '#8FCAD8', '#285865', '#CDB9EA', '#171B22', '#303743', '#8D98A7'],
  sage: ['#6F8D68', '#DCEBD6', '#B46F56', '#FFDDD2', '#8C7B54', '#FAF8F1', '#F0EEE4', '#CECABB', '#B7D5AF', '#405E3C', '#E9A68C', '#714532', '#D5C395', '#1B1D18', '#34382E', '#959B8B'],
  softPurple: ['#8067A8', '#EBDDFF', '#B2738A', '#FFD9E4', '#6E879B', '#FAF7FC', '#F1ECF4', '#D2C7D7', '#D2BBF4', '#57447A', '#E8A9BE', '#704558', '#AAC8DF', '#1D1922', '#37303D', '#9A8EA0'],
  quietGray: ['#586A70', '#DCE5E7', '#708A82', '#D9EAE4', '#8B766C', '#F7F6F3', '#EDECE8', '#CBC9C3', '#B5C9CF', '#3E5157', '#A5C9BE', '#415E56', '#D5BDB1', '#191B1B', '#303434', '#919797']
}

describe('Android theme palette parity', () => {
  it.each(Object.entries(palettes))('includes every exact %s light/dark token', (_name, colors) => {
    for (const color of colors) expect(css).toContain(color)
  })
})
