import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'
import { ensureDir, getDownloadDir, putFile } from '@/lib/downloadManager'
import { validateYoutubeUrl } from '@/lib/validateUrl'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function pickCmd(): { bin: string; argsPrefix: string[] } {
  // اگر YTDLP_PY ست باشد: python -m yt_dlp
  const py = process.env.YTDLP_PY?.trim()
  if (py) return { bin: py, argsPrefix: ['-m', 'yt_dlp'] }
  const pathBin = process.env.YTDLP_PATH?.trim() || 'yt-dlp'
  return { bin: pathBin, argsPrefix: [] }
}

function sse(data: unknown, event = 'message') {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

// تبدیل رشته عدد + واحد (MiB/GiB/...) به بایت
function unitToBytes(num: number, unit: string) {
  const map: Record<string, number> = {
    B: 1,
    KiB: 1024,
    MiB: 1024 ** 2,
    GiB: 1024 ** 3,
    TiB: 1024 ** 4,
  }
  return Math.round(num * (map[unit] || 1))
}

export async function GET(req: NextRequest) {
  try {
    const urlParam = req.nextUrl.searchParams.get('url')
    if (!urlParam) return new Response('url required', { status: 400 })

    const validUrl = validateYoutubeUrl(urlParam)

    const outDir = getDownloadDir()
    ensureDir(outDir)

    const id = randomUUID()
    const outTpl = path.join(outDir, `${id}.%(ext)s`)

    const fmt = 'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b/bv*+ba'
    const { bin, argsPrefix } = pickCmd()
    const args = [
      ...argsPrefix,
      '-f', fmt,
      '--remux-video', 'mp4',
      '--restrict-filenames',
      '--no-playlist',
      '-o', outTpl,
      validUrl.toString(),
    ]

    const headers = new Headers({
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      // اگر پشت Nginx هستید این هم کمک می‌کند:
      'X-Accel-Buffering': 'no',
    })

    let stderrBuf = ''
    let finalPath = ''

    const stream = new ReadableStream({
      start(controller) {
        const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], shell: false })

        // پیشرفت روی STDERR می‌آید
        child.stderr.on('data', (chunk) => {
          const text = chunk.toString()
          stderrBuf += text

          // مثال خطوط: "[download]  23.5% of 12.34MiB at 1.50MiB/s ETA 00:10"
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

            controller.enqueue(sse({
              percent,
              downloadedBytes,
              totalBytes,
              speed: speedStr,
              eta,
            }, 'progress'))
          }
        })

        child.on('close', (code) => {
          if (code !== 0) {
            controller.enqueue(sse({ error: stderrBuf || `yt-dlp exited ${code}` }, 'error'))
            controller.close()
            return
          }
          // پیدا کردن فایل خروجی
          const file = fs.readdirSync(outDir).find(f => f.startsWith(id + '.'))
          if (!file) {
            controller.enqueue(sse({ error: 'فایل خروجی پیدا نشد' }, 'error'))
            controller.close()
            return
          }
          finalPath = path.join(outDir, file)
          const token = putFile({ path: finalPath, createdAt: Date.now(), mime: 'video/mp4' })
          controller.enqueue(sse({ downloadUrl: `/api/files/${token}` }, 'done'))
          controller.close()
        })

        child.on('error', (err) => {
          controller.enqueue(sse({ error: String(err?.message || err) }, 'error'))
          controller.close()
        })
      },
      cancel() { /* در صورت قطع ارتباط، کاری لازم نیست */ }
    })

    return new Response(stream, { headers })
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return new Response(sse({ error: msg }, 'error'), {
      headers: { 'Content-Type': 'text/event-stream; charset=utf-8' },
      status: 500,
    })
  }
}
