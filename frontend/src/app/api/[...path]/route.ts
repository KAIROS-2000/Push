import { NextRequest, NextResponse } from 'next/server'

import { INTERNAL_API_URL } from '@/lib/server-env'

const AUTH_COOKIE_NAMES = ['codequest_access_token', 'codequest_refresh_token'] as const

export const dynamic = 'force-dynamic'

function backendUrl(path: string, search: string) {
  return `${INTERNAL_API_URL}/${path}${search}`
}

function proxiedCookieHeader(request: NextRequest) {
  const parts = AUTH_COOKIE_NAMES
    .map((name) => {
      const value = request.cookies.get(name)?.value
      return value ? `${name}=${encodeURIComponent(value)}` : ''
    })
    .filter(Boolean)
  return parts.join('; ')
}

function responseCookieHeaders(response: Response) {
  const headers = response.headers as Headers & {
    getSetCookie?: () => string[]
  }
  if (typeof headers.getSetCookie === 'function') {
    return headers.getSetCookie()
  }
  const fallback = response.headers.get('set-cookie')
  return fallback ? [fallback] : []
}

async function forwardRequest(
  request: NextRequest,
  context: { params: Promise<{ path: string[] }> },
) {
  const { path } = await context.params
  const upstreamHeaders = new Headers()
  const cookieHeader = proxiedCookieHeader(request)
  const contentType = request.headers.get('content-type')
  const accept = request.headers.get('accept')
  const authorization = request.headers.get('authorization')

  if (cookieHeader) {
    upstreamHeaders.set('cookie', cookieHeader)
  }
  if (contentType) {
    upstreamHeaders.set('content-type', contentType)
  }
  if (accept) {
    upstreamHeaders.set('accept', accept)
  }
  if (authorization) {
    upstreamHeaders.set('authorization', authorization)
  }

  const body =
    request.method === 'GET' || request.method === 'HEAD'
      ? undefined
      : await request.arrayBuffer()

  const upstreamResponse = await fetch(
    backendUrl(path.join('/'), request.nextUrl.search),
    {
      method: request.method,
      headers: upstreamHeaders,
      body: body && body.byteLength > 0 ? body : undefined,
      cache: 'no-store',
      redirect: 'manual',
    },
  )

  const responseHeaders = new Headers()
  for (const headerName of ['cache-control', 'content-type', 'etag', 'last-modified', 'vary']) {
    const value = upstreamResponse.headers.get(headerName)
    if (value) {
      responseHeaders.set(headerName, value)
    }
  }

  const response = new NextResponse(upstreamResponse.body, {
    status: upstreamResponse.status,
    headers: responseHeaders,
  })
  for (const cookie of responseCookieHeaders(upstreamResponse)) {
    response.headers.append('set-cookie', cookie)
  }
  return response
}

export async function GET(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forwardRequest(request, context)
}

export async function POST(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forwardRequest(request, context)
}

export async function PATCH(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forwardRequest(request, context)
}

export async function PUT(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forwardRequest(request, context)
}

export async function DELETE(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forwardRequest(request, context)
}

export async function OPTIONS(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  return forwardRequest(request, context)
}
