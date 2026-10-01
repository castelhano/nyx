// Muted categorical palette shared by the vehicle plan Gantt and the crew plan screens:
// fixed, well-spaced hues with one tone per theme (darker and less saturated in dark mode).
// Canvas consumers take resolved colors (swatchColor); DOM consumers can set them as CSS
// variables and switch with a `dark:` class.

const SWATCH_HUES = [212, 152, 38, 0, 268, 188, 92, 22, 328, 238, 168, 292]

// [saturation %, lightness %] per theme
const TONES = {
  // main fill — pieces, outbound trips (white text on top)
  strong: { light: [40, 50], dark: [28, 36] },
  // inbound trips — same hue, visibly lighter (white text still readable)
  mid:    { light: [36, 62], dark: [24, 46] },
  // background tint behind dark text — e.g. line color under a crew piece
  soft:   { light: [38, 74], dark: [24, 42] },
} as const

export type SwatchTone = keyof typeof TONES

export function swatchColor(index: number, tone: SwatchTone, theme: 'light' | 'dark'): string {
  const n   = SWATCH_HUES.length
  const hue = SWATCH_HUES[((index % n) + n) % n]
  const [s, l] = TONES[tone][theme]
  return `hsl(${hue} ${s}% ${l}%)`
}

// Line code → palette index by code order, so a line keeps its color regardless of which
// lines are selected/filtered — pass the lines the plan runs (not the whole Scope, which
// wraps the 12-hue palette sooner) for the same color in the vehicle and crew screens.
export function lineIndexByCode(codes: string[]): Map<string, number> {
  const sorted = [...new Set(codes)].sort((a, b) => a.localeCompare(b, 'pt-BR', { numeric: true }))
  return new Map(sorted.map((code, i) => [code, i]))
}
