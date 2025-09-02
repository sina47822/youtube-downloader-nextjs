import { NextRequest, NextResponse } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { ensureDir, getDownloadDir, putFile } from '@/lib/downloadManager'
import { validateYoutubeUrl } from '@/lib/validateUrl'
import { randomUUID } from 'crypto'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// اگر YTDLP_PY ست باشد، python + '-m yt_dlp' اجرا می‌کنیم.
// در غیر این صورت، تلاش می‌کنیم باینری yt-dlp را مستقیم اجرا کنیم.
function findRunner():
  | { bin: string; argsPrefix: string[] } {
  const py = process.env.YTDLP_PY
  if (py && py.trim()) {
    return { bin: py.trim(), argsPrefix: ['-m', 'yt_dlp'] }
  }
  const bin = (process.env.YTDLP_PATH || 'yt-dlp').trim()
  return { bin, argsPrefix: [] }
}

export async function POST(req: NextRequest) {
  try {
    const { url, format } = await req.json()
    const validUrl = validateYoutubeUrl(url)

    const outDir = getDownloadDir()
    ensureDir(outDir)

    const id = randomUUID()
    const outTpl = path.join(outDir, `${id}.%(ext)s`)

    const fmt = typeof format === 'string' && format.trim()
      ? format.trim()
      : 'bv*+ba/b'

    const { bin, argsPrefix } = findRunner()

    const args = [
      ...argsPrefix,
      '-f', fmt,
      '--merge-output-format', 'mp4',
      '--restrict-filenames',
      '-o', outTpl,
      '--no-playlist',
      validUrl.toString(),
    ]

    // نکته: چون bin یک فایل اجرایی واقعی است، shell: false باقی بماند
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })

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
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message || 'خطای ناشناخته' }, { status: 400 })
  }
}
