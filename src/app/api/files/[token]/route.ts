// src/app/api/files/[token]/route.ts
import type { NextRequest } from 'next/server'
import fs from 'fs'
import path from 'path'
import mime from 'mime-types'
import { takeFile } from '@/lib/downloadManager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params

  const entry = takeFile(token)
  if (!entry) {
    return new Response('لینک نامعتبر یا منقضی شده است', { status: 404 })
  }

  const { path: filePath, mime: provided } = entry
  const stat = fs.statSync(filePath)
  const mt =
    provided || (mime.lookup(path.extname(filePath)) || 'application/octet-stream')

  const headers = new Headers()
  headers.set('Content-Type', String(mt))
  headers.set('Content-Length', String(stat.size))
  headers.set('Content-Disposition', `attachment; filename="${path.basename(filePath)}"`)

  const file = fs.createReadStream(filePath)
  const stream = new ReadableStream({
    start(controller) {
      file.on('data', (chunk) => controller.enqueue(chunk))
      file.on('end', () => {
        controller.close()
        try { fs.unlinkSync(filePath) } catch {}
      })
      file.on('error', (err) => {
        controller.error(err)
        try { fs.unlinkSync(filePath) } catch {}
      })
    },
  })

  return new Response(stream, { headers })
}