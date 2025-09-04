import { NextRequest } from 'next/server'
import { spawn } from 'child_process'
import path from 'path'
import fs from 'fs'
import ffmpegPath from 'ffmpeg-static'
import { ensureDir, getDownloadDir, putFile } from '@/lib/downloadManager'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function sse(event: string, data: unknown) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}
function asUint8(s: string) {
  return new TextEncoder().encode(s)
}

// یک regex ساده برای لاین‌های پیشرفت yt-dlp
const RX_PROGRESS = /\[download\]\s+(\d+(?:\.\d+)?)%.*?(?:of\s+([^\s]+))?.*?(?:at\s+([^\s]+))?.*?(?:ETA\s+([^\s]+))?/

function pickCmd(): { bin: string; argsPrefix: string[] } {
  const pathBin = process.env.YTDLP_PATH?.trim()
  if (pathBin) return { bin: pathBin, argsPrefix: [] }
  const py = process.env.YTDLP_PY?.trim()
  if (py) return { bin: py, argsPrefix: ['-m', 'yt_dlp'] }
  return { bin: 'yt-dlp', argsPrefix: [] }
}

export async function GET(req: NextRequest) {
  const url = req.nextUrl.searchParams.get('url') || ''
  const playlist = req.nextUrl.searchParams.get('playlist') === '1'
  const debug = req.nextUrl.searchParams.get('debug') === '1'

  const stream = new ReadableStream({
    start(controller) {
      const send = (event: string, data: unknown) => controller.enqueue(asUint8(sse(event, data)))
      const heartbeat = setInterval(() => controller.enqueue(asUint8(': keep-alive\n\n')), 15000)

      const valid = /^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(url)
      if (!valid) {
        send('error', { error: 'لینک یوتیوب معتبر نیست' })
        clearInterval(heartbeat)
        controller.close()
        return
      }

      const outDir = getDownloadDir()
      try { ensureDir(outDir) } catch (e: any) {
        send('error', { error: 'عدم دسترسی به مسیر ذخیره‌سازی', detail: e?.message })
        clearInterval(heartbeat)
        controller.close()
        return
      }

      const { bin, argsPrefix } = pickCmd()
      const outTpl = path.join(outDir, `${Date.now()}_%(id)s.%(ext)s`)
      const fmt = 'b[ext=mp4]/bv*[ext=mp4]+ba[ext=m4a]/b/bv*+ba'
      const args = [
        ...argsPrefix,
        '-f', fmt,
        '--restrict-filenames',
        playlist ? '--yes-playlist' : '--no-playlist',
        '--newline',
        '--print', 'after_move:filepath',
        '-o', outTpl,
        url,
      ]

      if (ffmpegPath) {
        args.push('--ffmpeg-location', path.dirname(ffmpegPath as string))
        args.push('--remux-video', 'mp4')
      }

      if (debug) args.unshift('-v')

      // پیش از دانلود نسخه را چک کنیم تا ارور واضح باشد
      const t = spawn(bin, [...argsPrefix, '--version'], { stdio: ['ignore','ignore','pipe'] })
      let versionSE = ''
      t.stderr.on('data', d => versionSE += d.toString())
      t.on('close', (c) => {
        if (c !== 0) {
          send('error', { error: versionSE || `yt-dlp --version exited ${c}` })
          clearInterval(heartbeat)
          controller.close()
          return
        }

        const child = spawn(bin, args, { stdio: ['ignore','pipe','pipe'] })
        let stderr = ''
        let stdoutBuf = ''
        let lastPercent = -1

        // stdout: after_move:filepath (یک خط به ازای هر فایل کامل)
        child.stdout.on('data', (chunk) => {
          stdoutBuf += chunk.toString()
          let i
          while ((i = stdoutBuf.indexOf('\n')) !== -1) {
            const line = stdoutBuf.slice(0, i).trim()
            stdoutBuf = stdoutBuf.slice(i + 1)
            if (!line) continue

            const filePath = line
            const exists = fs.existsSync(filePath)
            const stat = exists ? fs.statSync(filePath) : null
            const ext = path.extname(filePath).slice(1).toLowerCase()
            const mime = ext === 'mp4' ? 'video/mp4' : ext === 'webm' ? 'video/webm' : 'application/octet-stream'

            const token = putFile({
              path: filePath,
              createdAt: Date.now(),
              mime,
              filename: path.basename(filePath),
              sizeBytes: stat?.size,
            })

            send('file', {
              downloadUrl: `/api/files/${token}`,
              filename: path.basename(filePath),
              sizeBytes: stat?.size ?? 0
            })
          }
        })

        // stderr: لاگ و پیشرفت
        child.stderr.on('data', (d) => {
          const text = d.toString()
          stderr += text
          if (debug) send('log', { line: text })

          const m = text.match(RX_PROGRESS)
          if (m) {
            const percent = parseFloat(m[1])
            if (!Number.isNaN(percent) && percent !== lastPercent) {
              lastPercent = percent
              send('progress', {
                percent,
                downloadedBytes: 0,
                totalBytes: 0,
                speed: m[3],
                eta: m[4],
              })
            }
          }
          // عنوان احتمالی:
          const dest = text.match(/\[download\]\s+Destination:\s+(.+)/)
          if (dest) send('info', { title: path.basename(dest[1]) })
          const size = text.match(/\[download\]\s+Total file size:\s+(.+)/)
          if (size) send('info', { totalBytesText: size[1] })
        })

        child.on('error', (err) => {
          send('error', { error: err.message })
          clearInterval(heartbeat)
          controller.close()
        })

        child.on('close', (code) => {
          if (code !== 0) {
            send('error', { error: stderr || `yt-dlp exited ${code}` })
          } else {
            send('done', { ok: true })
          }
          clearInterval(heartbeat)
          controller.close()
        })
      })
    },
    cancel() { /* noop */ }
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    }
  })
}
