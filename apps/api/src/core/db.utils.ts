const url = process.env.DATABASE_URL ?? ''
const isPostgres = url.startsWith('postgresql') || url.startsWith('postgres')

export function stringContains(val: string) {
  return isPostgres
    ? { contains: val, mode: 'insensitive' as const }
    : { contains: val }
}
