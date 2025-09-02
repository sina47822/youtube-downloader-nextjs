// src/app/api/download/stream/route.ts
import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import { randomUUID } from 'crypto'
import { ensureDir, getDownloadDir, putFile } from '@/lib/downloadManager'
import { validateYoutubeUrl } from '@/lib/validateUrl'
import fs from 'fs'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// === types & helpers (بدون any) ===
type YtFormat = { filesize?: number; filesize_approx?: number }
type YtDump = {
  title?: string
  filesize?: number
  filesize_approx?: number
  requested_formats?: YtFormat[]
}

function pickCmd(): { bin: string; argsPrefix: string[] } {
  const pathBin = process.env.YTDLP_PATH?.trim()
  if (pathBin) return { bin: pathBin, argsPrefix: [] }
  const py = process.env.YTDLP_PY?.trim()
  if (py) return { bin: py, argsPrefix: ['-m', 'yt_dlp'] }
  return { bin: 'yt-dlp', argsPrefix: [] }
}

function sse(data: unknown, event = 'message') {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

function unitToBytes(num: number, unit: string) {
  const map: Record<string, number> = { B: 1, KiB: 1024, MiB: 1024 ** 2, GiB: 1024 ** 3, TiB: 1024 ** 4 }
  return Math.round(num * (map[unit] || 1))
}

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

export async function GET(req: NextRequest) {
  const urlParam = req.nextUrl.searchParams.get('url')
  const playlistFlag = req.nextUrl.searchParams.get('playlist')
  const allowPlaylist = playlistFlag === '1' || playlistFlag === 'true'

  if (!urlParam) return new Response('url required', { status: 400 })

  try {
    const validUrl = validateYoutubeUrl(urlParam)

    const outDir = getDownloadDir()
    ensureDir(outDir)

    const id = randomUUID()
    const outTpl = path.join(outDir, `${id}.%(ext)s`)
    const fmt = 'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b/bv*+ba'
    const { bin, argsPrefix } = pickCmd()

    // --- (اختیاری) دریافت info برای تک‌ویدئو
    let infoTotalBytes = 0
    let infoTitle = ''
    let infoIsPlaylist = false
    let infoEntryCount = 0

    if (!allowPlaylist) {
      const infoArgs = [
        ...argsPrefix,
        '-f', fmt,
        '--simulate',
        '--dump-json',
        '--no-warnings',
        '--no-playlist',
        validUrl.toString(),
      ]
      const info = spawn(bin, infoArgs, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })
      let infoStdout = ''
      await new Promise<void>((resolve) => {
        info.stdout.on('data', (d) => { infoStdout += d.toString() })
        info.on('close', () => resolve())
        info.on('error', () => resolve())
      })
      try {
        const j = JSON.parse(infoStdout) as YtDump
        infoTitle = j.title || ''
        if (Array.isArray(j.requested_formats) && j.requested_formats.length) {
          infoTotalBytes = j.requested_formats.reduce<number>((acc, f) => {
            const size = typeof f.filesize === 'number' ? f.filesize
              : (typeof f.filesize_approx === 'number' ? f.filesize_approx : 0)
            return acc + size
          }, 0)
        } else {
          infoTotalBytes =
            (typeof j.filesize === 'number' ? j.filesize
              : (typeof j.filesize_approx === 'number' ? j.filesize_approx : 0))
        }
      } catch { /* ignore malformed JSON */ }
    } else {
      infoIsPlaylist = true
      infoEntryCount = 0
    }

    const dlArgs = [
      ...argsPrefix,
      '-f', fmt,
      '--remux-video', 'mp4',
      '--restrict-filenames',
      '--newline',
      ...(allowPlaylist ? [] : ['--no-playlist']),
      '--print', 'after_move:filepath',
      '-o', outTpl,
      validUrl.toString(),
    ]

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    })

    const stream = new ReadableStream({
      start(controller) {
        controller.enqueue(sse({
          title: infoTitle || undefined,
          totalBytes: infoTotalBytes || undefined,
          isPlaylist: infoIsPlaylist || undefined,
          entryCount: infoEntryCount || undefined,
        }, 'info'))

        const child = spawn(bin, dlArgs, { stdio: ['pipe', 'pipe', 'pipe'], shell: false })

        // stdout: مسیر فایل‌های نهایی
        child.stdout.on('data', (chunk) => {
          const lines = chunk.toString().split(/\r?\n/).map((s: string) => s.trim()).filter(Boolean)
          for (const line of lines) {
            try {
              const filePath = line
              const stat = fs.statSync(filePath)
              const token = putFile({ path: filePath, createdAt: Date.now(), mime: 'video/mp4' })
              controller.enqueue(sse({
                downloadUrl: `/api/files/${token}`,
                filename: path.basename(filePath),
                sizeBytes: stat.size,
              }, 'file'))
            } catch (e: unknown) {
              controller.enqueue(sse({ error: toErrorMessage(e) }, 'error'))
            }
          }
        })

        // stderr: پیشرفت دانلود
        child.stderr.on('data', (chunk) => {
          const text = chunk.toString()
          const re = /\[download\]\s+(\d+(?:\.\d+)?)%\s+of\s+([\d.]+)([KMGTP]iB)\s+at\s+([^\s]+\/s|N\/A)\s+ETA\s+([0-9:]+)/g
          let m: RegExpExecArray | null
          while ((m = re.exec(text))) {
            const percent = parseFloat(m[1])
            const totalNum = parseFloat(m[2])
            const totalUnit = m[3]
            const speedStr = m[4]
            const eta = m[5]
            const totalBytes = unitToBytes(totalNum, totalUnit)
            const downloadedBytes = Math.round((percent / 100) * totalBytes)
            controller.enqueue(sse({ percent, downloadedBytes, totalBytes, speed: speedStr, eta }, 'progress'))
          }
        })

        child.on('close', (code) => {
          if (code !== 0) {
            controller.enqueue(sse({ error: `yt-dlp exited ${code}` }, 'error'))
          } else {
            controller.enqueue(sse({ ok: true }, 'done'))
          }
          controller.close()
        })

        child.on('error', (err: unknown) => {
          controller.enqueue(sse({ error: toErrorMessage(err) }, 'error'))
          controller.close()
        })
      },
    })

    return new Response(stream, { headers })
  } catch (err: unknown) {
    return new Response(sse({ error: toErrorMessage(err) }, 'error'), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 500,
    })
  }
}
