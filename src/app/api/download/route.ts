// src/app/api/download/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { ensureDir, getDownloadDir, putFile } from '@/lib/downloadManager'
import { validateYoutubeUrl } from '@/lib/validateUrl'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}
type DownloadBody = { url: string; format?: string }

function pickCmd(): { bin: string; argsPrefix: string[] } {
  const pathBin = process.env.YTDLP_PATH?.trim()
  if (pathBin) return { bin: pathBin, argsPrefix: [] }
  const py = process.env.YTDLP_PY?.trim()
  if (py) return { bin: py, argsPrefix: ['-m', 'yt_dlp'] }
  return { bin: 'yt-dlp', argsPrefix: [] }
}

export async function POST(req: NextRequest) {
  try {
    const { url, format } = (await req.json()) as DownloadBody
    const validUrl = validateYoutubeUrl(url)

    const outDir = getDownloadDir()
    ensureDir(outDir)

    const id = randomUUID()
    const outTpl = path.join(outDir, `${id}.%(ext)s`)
    const fmt = (typeof format === 'string' && format.trim())
      ? format.trim()
      : 'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b/bv*+ba'

    const { bin, argsPrefix } = pickCmd()
    const args = [
      ...argsPrefix,
      '-f', fmt,
      '--remux-video', 'mp4',
      '--restrict-filenames',
      '--no-playlist',
      '--newline',
      '--print', 'after_move:filepath',
      '-o', outTpl,
      validUrl.toString(),
    ]

    const child = spawn(bin, args, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })

    let stderr = ''
    let finalPath = ''

    child.stdout.on('data', (d) => {
      const line = d.toString().trim()
      if (line) finalPath = line
    })
    child.stderr.on('data', (d) => { stderr += d.toString() })

    const done: Promise<void> = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr || `yt-dlp exited ${code}`))
        if (!finalPath) return reject(new Error('مسیر فایل نهایی از yt-dlp دریافت نشد'))
        resolve()
      })
    })

    const timeoutMs = 10 * 60 * 1000
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeoutMs)

    try { await done } finally { clearTimeout(timer) }

    const token = putFile({ path: finalPath, createdAt: Date.now(), mime: 'video/mp4' })

    return NextResponse.json({ ok: true, downloadUrl: `/api/files/${token}` })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: toErrorMessage(e) || 'خطای ناشناخته' },
      { status: 400 }
    )
  }
}
