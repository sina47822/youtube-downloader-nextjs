'use client'
import { useEffect, useRef, useState } from 'react'

function formatBytes(b: number): string {
  if (!Number.isFinite(b) || b <= 0) return '0 B'
  const u = ['B','KB','MB','GB','TB']
  let i = 0, n = b
  while (n >= 1024 && i < u.length - 1) { n /= 1024; i++ }
  return `${n.toFixed(1)} ${u[i]}`
}

type Prog = { percent: number; downloadedBytes: number; totalBytes: number; speed?: string; eta?: string }

export default function Page() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [prog, setProg] = useState<Prog | null>(null)
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => () => { esRef.current?.close() }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setDownloadUrl(null)
    setProg(null)
    setLoading(true)

    // از SSE استفاده می‌کنیم
    const es = new EventSource(`/api/download/stream?url=${encodeURIComponent(url)}`)
    esRef.current = es

    es.addEventListener('progress', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Prog
        setProg(data)
      } catch {}
    })

    es.addEventListener('done', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { downloadUrl: string }
        setDownloadUrl(data.downloadUrl)
      } finally {
        setLoading(false)
        es.close()
      }
    })

    es.addEventListener('error', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { error?: string }
        setError(data?.error || 'خطا در دانلود')
      } catch {
        setError('خطا در دانلود')
      } finally {
        setLoading(false)
        es.close()
      }
    })
  }

  const percent = prog?.percent ?? 0
  const downloaded = formatBytes(prog?.downloadedBytes ?? 0)
  const total = formatBytes(prog?.totalBytes ?? 0)

  return (
    <main className="max-w-xl mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">دانلود YouTube با yt-dlp</h1>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="url"
          required
          placeholder="مثلاً https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setUrl(e.target.value)}
          className="w-full border rounded p-3"
        />
        <button disabled={loading} className="px-4 py-2 rounded bg-black text-white disabled:opacity-50">
          {loading ? 'در حال دانلود...' : 'دانلود'}
        </button>
      </form>

      {prog && (
        <div className="mt-4 space-y-2">
          <div className="w-full bg-gray-200 rounded h-3 overflow-hidden">
            <div
              className="bg-green-600 h-3"
              style={{ width: `${Math.min(100, Math.max(0, percent)).toFixed(1)}%` }}
            />
          </div>
          <div className="text-sm text-gray-700">
            {percent.toFixed(1)}% — {downloaded} / {total}
            {prog.speed ? <> — سرعت: {prog.speed}</> : null}
            {prog.eta ? <> — زمان باقیمانده: {prog.eta}</> : null}
          </div>
        </div>
      )}

      {error && <p className="text-red-600 mt-4">{error}</p>}

      {downloadUrl && (
        <a href={downloadUrl} className="mt-4 inline-block underline">دریافت فایل</a>
      )}

      <p className="text-sm text-gray-500 mt-6">
        فقط لینک‌های یوتیوب مجاز است. لینک ایجادشده یک‌بارمصرف است.
      </p>
    </main>
  )
}
