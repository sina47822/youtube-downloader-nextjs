import fs from 'fs'
import path from 'path'
import { NextRequest } from 'next/server'
import { getFileByToken } from '@/lib/downloadManager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(_req: NextRequest, ctx: { params: { token: string } }) {
  const token = ctx.params.token
  const f = getFileByToken(token)
  if (!f) return new Response('Not found', { status: 404 })
  if (!fs.existsSync(f.path)) return new Response('Gone', { status: 410 })

  const stat = fs.statSync(f.path)
  const headers = new Headers({
    'Content-Type': f.mime || 'application/octet-stream',
    'Content-Length': String(stat.size),
    'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(f.filename || path.basename(f.path))}`
  })

  const stream = fs.createReadStream(f.path)
  // (اختیاری) بعد از دانلود پاک کن:
  // stream.on('close', () => { try { fs.unlinkSync(f.path) } catch {} })

  return new Response(stream as unknown as ReadableStream, { headers })
}
