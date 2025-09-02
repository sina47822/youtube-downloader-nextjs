// src/app/api/download/route.ts
import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { ensureDir, getDownloadDir, putFile } from '@/lib/downloadManager'
import { validateYoutubeUrl } from '@/lib/validateUrl'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// کمک: تبدیل هر خطا به پیام مناسب
function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

type DownloadBody = { url: string; format?: string }

export async function POST(req: NextRequest) {
  try {
    const { url, format } = (await req.json()) as DownloadBody
    const validUrl = validateYoutubeUrl(url)

    const outDir = getDownloadDir()
    ensureDir(outDir)

    const id = randomUUID()
    const outTpl = path.join(outDir, `${id}.%(ext)s`)

    const fmt = typeof format === 'string' && format.trim() ? format.trim() : 'bv*+ba/b'
    const cmd = (process.env.YTDLP_PY?.trim())
      ? process.env.YTDLP_PY.trim()
      : (process.env.YTDLP_PATH?.trim() || 'yt-dlp')

    const args = [
      ...(process.env.YTDLP_PY ? ['-m', 'yt_dlp'] : []),
      '-f', fmt,
      '--merge-output-format', 'mp4',
      '--restrict-filenames',
      '-o', outTpl,
      '--no-playlist',
      validUrl.toString(),
    ]

    const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })

    let stderr = ''
    child.stderr.on('data', (d) => { stderr += d.toString() })

    const done: Promise<string> = new Promise((resolve, reject) => {
      child.on('error', reject)
      child.on('close', (code) => {
        if (code !== 0) return reject(new Error(stderr || `yt-dlp exited ${code}`))
        const file = fs.readdirSync(outDir).find(f => f.startsWith(id + '.'))
        if (!file) return reject(new Error('فایل خروجی پیدا نشد'))
        resolve(path.join(outDir, file))
      })
    })

    const timeoutMs = 10 * 60 * 1000
    const timer = setTimeout(() => { try { child.kill('SIGKILL') } catch {} }, timeoutMs)

    let finalPath = ''
    try { finalPath = await done } finally { clearTimeout(timer) }

    const token = putFile({ path: finalPath, createdAt: Date.now(), mime: 'video/mp4' })

    return NextResponse.json({ ok: true, downloadUrl: `/api/files/${token}` })
  } catch (e: unknown) {
    return NextResponse.json(
      { ok: false, error: toErrorMessage(e) || 'خطای ناشناخته' },
      { status: 400 }
    )
  }
}
