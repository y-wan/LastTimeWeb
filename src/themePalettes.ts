import type { ColorTheme, ThemeMode } from './types'

export type PaletteRoles = {
  primary: string
  onPrimary: string
  primaryContainer: string
  onPrimaryContainer: string
  primaryText: string
  secondary: string
  onSecondary: string
  secondaryContainer: string
  onSecondaryContainer: string
  secondaryText: string
  tertiary: string
  onTertiary: string
  tertiaryText: string
  background: string
  surface: string
  surfaceHigh: string
  text: string
  muted: string
  outline: string
  danger: string
}

export type ThemePalette = {
  id: ColorTheme
  light: PaletteRoles
  dark: PaletteRoles
}

export const THEME_PALETTES: ThemePalette[] = [
  {
    id: 'vitalOrange',
    light: {
      primary: '#D65A3A', onPrimary: '#1F0A04', primaryContainer: '#F9DDD4', onPrimaryContainer: '#5D1C0D', primaryText: '#B1462D',
      secondary: '#0F8C80', onSecondary: '#00100E', secondaryContainer: '#D5F2EE', onSecondaryContainer: '#0B4F49', secondaryText: '#0A7168',
      tertiary: '#D9982E', onTertiary: '#251700', tertiaryText: '#8A5B0A',
      background: '#FAF7F3', surface: '#FFFFFF', surfaceHigh: '#F2ECE7',
      text: '#25211F', muted: '#655E59', outline: '#D1C5BD', danger: '#B3261E'
    },
    dark: {
      primary: '#FFB49F', onPrimary: '#5A1809', primaryContainer: '#7C2C19', onPrimaryContainer: '#FFDACE', primaryText: '#FFB49F',
      secondary: '#6ED8CC', onSecondary: '#003733', secondaryContainer: '#005047', onSecondaryContainer: '#9CF2E7', secondaryText: '#6ED8CC',
      tertiary: '#F2C46D', onTertiary: '#422B00', tertiaryText: '#F2C46D',
      background: '#171513', surface: '#201D1A', surfaceHigh: '#2B2723',
      text: '#F1EAE5', muted: '#C8BEB8', outline: '#8D817A', danger: '#FFB4AB'
    }
  },
  {
    id: 'mistBlue',
    light: {
      primary: '#3F6FD4', onPrimary: '#FFFFFF', primaryContainer: '#DCE6FF', onPrimaryContainer: '#16356F', primaryText: '#3A68C8',
      secondary: '#0D8B9A', onSecondary: '#001215', secondaryContainer: '#D2F0F4', onSecondaryContainer: '#064D57', secondaryText: '#08717D',
      tertiary: '#795CC2', onTertiary: '#FFFFFF', tertiaryText: '#674AA8',
      background: '#F4F7FB', surface: '#FFFFFF', surfaceHigh: '#EAF0F7',
      text: '#1D2430', muted: '#5B6472', outline: '#C7D0DD', danger: '#B3261E'
    },
    dark: {
      primary: '#ABC7FF', onPrimary: '#0A326F', primaryContainer: '#234E96', onPrimaryContainer: '#DCE6FF', primaryText: '#ABC7FF',
      secondary: '#79D4E0', onSecondary: '#00363D', secondaryContainer: '#07505A', onSecondaryContainer: '#A6EDF5', secondaryText: '#79D4E0',
      tertiary: '#CFBCFF', onTertiary: '#382267', tertiaryText: '#CFBCFF',
      background: '#121722', surface: '#1B2230', surfaceHigh: '#252E3D',
      text: '#E8EDF7', muted: '#BCC5D3', outline: '#7C8797', danger: '#FFB4AB'
    }
  },
  {
    id: 'sage',
    light: {
      primary: '#4F7F55', onPrimary: '#FFFFFF', primaryContainer: '#D8EBD7', onPrimaryContainer: '#173D1E', primaryText: '#47734C',
      secondary: '#C45F45', onSecondary: '#180704', secondaryContainer: '#FADDD5', onSecondaryContainer: '#642313', secondaryText: '#9F4833',
      tertiary: '#A67834', onTertiary: '#1B1000', tertiaryText: '#7C5722',
      background: '#F6F8F2', surface: '#FFFFFF', surfaceHigh: '#ECF1E7',
      text: '#20271F', muted: '#5D675B', outline: '#C7D0C1', danger: '#B3261E'
    },
    dark: {
      primary: '#A8D5AA', onPrimary: '#123617', primaryContainer: '#315E38', onPrimaryContainer: '#C4EBC4', primaryText: '#A8D5AA',
      secondary: '#FFB49E', onSecondary: '#5D1609', secondaryContainer: '#7C2D1A', onSecondaryContainer: '#FFDACE', secondaryText: '#FFB49E',
      tertiary: '#E6C178', onTertiary: '#3E2D00', tertiaryText: '#E6C178',
      background: '#131813', surface: '#1B221B', surfaceHigh: '#252D24',
      text: '#E8F0E6', muted: '#BBC7B8', outline: '#7E897A', danger: '#FFB4AB'
    }
  },
  {
    id: 'softPurple',
    light: {
      primary: '#7655C6', onPrimary: '#FFFFFF', primaryContainer: '#E9DFFF', onPrimaryContainer: '#38206F', primaryText: '#7655C6',
      secondary: '#C44F78', onSecondary: '#150209', secondaryContainer: '#F9D9E4', onSecondaryContainer: '#681B38', secondaryText: '#A33C61',
      tertiary: '#397F98', onTertiary: '#FFFFFF', tertiaryText: '#2F6F86',
      background: '#F8F5FB', surface: '#FFFFFF', surfaceHigh: '#F0EAF6',
      text: '#251F2B', muted: '#655D6B', outline: '#D0C6D7', danger: '#B3261E'
    },
    dark: {
      primary: '#D0BCFF', onPrimary: '#3B216E', primaryContainer: '#543B91', onPrimaryContainer: '#E9DFFF', primaryText: '#D0BCFF',
      secondary: '#FFAFCA', onSecondary: '#61142F', secondaryContainer: '#7E2947', onSecondaryContainer: '#FFD9E4', secondaryText: '#FFAFCA',
      tertiary: '#94CDE1', onTertiary: '#003543', tertiaryText: '#94CDE1',
      background: '#18151E', surface: '#211D29', surfaceHigh: '#2C2735',
      text: '#EFE9F3', muted: '#C8BFCE', outline: '#897F91', danger: '#FFB4AB'
    }
  },
  {
    id: 'quietGray',
    light: {
      primary: '#3C6975', onPrimary: '#FFFFFF', primaryContainer: '#D5E8ED', onPrimaryContainer: '#123943', primaryText: '#3C6975',
      secondary: '#367E69', onSecondary: '#FFFFFF', secondaryContainer: '#D5EDE5', onSecondaryContainer: '#124536', secondaryText: '#347965',
      tertiary: '#B96742', onTertiary: '#180A04', tertiaryText: '#945034',
      background: '#F4F7F7', surface: '#FFFFFF', surfaceHigh: '#E9EFEF',
      text: '#1E2527', muted: '#5C6669', outline: '#C5CFD1', danger: '#B3261E'
    },
    dark: {
      primary: '#A8CED8', onPrimary: '#0B353F', primaryContainer: '#28515C', onPrimaryContainer: '#D5E8ED', primaryText: '#A8CED8',
      secondary: '#9DD4BF', onSecondary: '#063729', secondaryContainer: '#205544', onSecondaryContainer: '#C2EFDC', secondaryText: '#9DD4BF',
      tertiary: '#F0B394', onTertiary: '#52200C', tertiaryText: '#F0B394',
      background: '#131819', surface: '#1B2224', surfaceHigh: '#252E30',
      text: '#E8EEEE', muted: '#BCC7C9', outline: '#7D898C', danger: '#FFB4AB'
    }
  }
]

export function resolvedPaletteRoles(palette: ColorTheme, theme: ThemeMode, systemDark: boolean) {
  const selected = THEME_PALETTES.find((item) => item.id === palette) ?? THEME_PALETTES[0]
  return theme === 'dark' || (theme === 'system' && systemDark) ? selected.dark : selected.light
}

export function paletteCssVariables(roles: PaletteRoles) {
  return {
    '--primary': roles.primary,
    '--on-primary': roles.onPrimary,
    '--primary-container': roles.primaryContainer,
    '--on-primary-container': roles.onPrimaryContainer,
    '--primary-text': roles.primaryText,
    '--secondary': roles.secondary,
    '--on-secondary': roles.onSecondary,
    '--secondary-container': roles.secondaryContainer,
    '--on-secondary-container': roles.onSecondaryContainer,
    '--secondary-text': roles.secondaryText,
    '--tertiary': roles.tertiary,
    '--on-tertiary': roles.onTertiary,
    '--tertiary-text': roles.tertiaryText,
    '--bg': roles.background,
    '--surface': roles.surface,
    '--surface-high': roles.surfaceHigh,
    '--text': roles.text,
    '--muted': roles.muted,
    '--outline': roles.outline,
    '--danger': roles.danger
  } as const
}
