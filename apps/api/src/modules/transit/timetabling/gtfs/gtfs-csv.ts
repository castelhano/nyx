export interface GtfsTable {
  fields: string[]
  rows:   Record<string, string>[]
}

// Quotes every value, like the feeds Goal itself exports
export function gtfsCsv({ fields, rows }: GtfsTable): string {
  const quote = (value: string) => `"${value.replace(/"/g, '""')}"`
  const line  = (values: string[]) => values.map(quote).join(',')
  return [line(fields), ...rows.map(r => line(fields.map(f => r[f] ?? '')))].join('\n') + '\n'
}
