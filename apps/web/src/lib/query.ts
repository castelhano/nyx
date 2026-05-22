export function httpError(status: number): Error {
  return Object.assign(new Error('HTTP error'), { status })
}

export function httpRetry(_: number, err: unknown): boolean {
  const status = (err as { status?: number })?.status
  return !status || status >= 500
}
