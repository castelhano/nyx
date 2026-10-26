import { NextRequest, NextResponse } from 'next/server'

// /portal: the crew portal has its own session (portalToken, checked by its API)
const PUBLIC_PATHS = ['/login', '/portal']

export function proxy(req: NextRequest) {
  const { pathname } = req.nextUrl
  const isPublic = PUBLIC_PATHS.some((p) => pathname.startsWith(p))

  if (isPublic) return NextResponse.next()

  const token = req.cookies.get('token')?.value
  if (!token) {
    return NextResponse.redirect(new URL('/login', req.url))
  }

  return NextResponse.next()
}

export const config = {
  matcher: ['/((?!_next|favicon.ico|api).*)'],
}
