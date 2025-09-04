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
type FileItem = { downloadUrl: string; filename: string; sizeBytes: number }

export default function Page() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)
  const [prog, setProg] = useState<Prog | null>(null)
  const [title, setTitle] = useState<string | null>(null)
  const [totalBytes, setTotalBytes] = useState<number | null>(null)
  const [files, setFiles] = useState<FileItem[]>([])
  const esRef = useRef<EventSource | null>(null)

  useEffect(() => () => { esRef.current?.close() }, [])

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setDownloadUrl(null)
    setProg(null)
    setTitle(null)
    setTotalBytes(null)
    setFiles([])
    setLoading(true)

    const es = new EventSource(`/api/download?url=${encodeURIComponent(url)}&debug=1`)
    esRef.current = es

    es.addEventListener('open', () => console.log('SSE opened'))

    es.addEventListener('info', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as { title?: string; totalBytes?: number; totalBytesText?: string }
        if (data.title) setTitle(data.title)
        if (typeof data.totalBytes === 'number') setTotalBytes(data.totalBytes)
      } catch {}
    })

    es.addEventListener('progress', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as Prog
        setProg(data)
        if (typeof data.totalBytes === 'number' && !totalBytes) setTotalBytes(data.totalBytes)
      } catch {}
    })

    es.addEventListener('file', (ev) => {
      try {
        const data = JSON.parse((ev as MessageEvent).data) as FileItem
        setFiles(prev => [...prev, data])
        if (!downloadUrl) setDownloadUrl(data.downloadUrl)
      } catch {}
    })

    es.addEventListener('done', () => {
      setLoading(false)
      es.close()
    })

    es.addEventListener('log', (ev) => {
      try {
        const { line } = JSON.parse((ev as MessageEvent).data)
        if (line) console.debug('[yt-dlp]', line.trim())
      } catch {}
    })

    es.addEventListener('error', (ev) => {
      const msgEvt = ev as MessageEvent
      if (typeof msgEvt.data === 'string' && msgEvt.data.length) {
        try {
          const data = JSON.parse(msgEvt.data) as { error?: string }
          setError(data?.error || 'خطا')
        } catch {
          setError(msgEvt.data)
        }
      } else {
        console.error('SSE error / network:', es.readyState, ev)
        setError('اتصال برقرار نشد یا پاسخ معتبر نبود')
      }
      setLoading(false)
      es.close()
    })
  }

  const percent = prog?.percent ?? (totalBytes ? Math.min(100, Math.round(((prog?.downloadedBytes ?? 0) / totalBytes) * 100)) : 0)
  const downloaded = formatBytes(prog?.downloadedBytes ?? 0)
  const total = formatBytes(totalBytes ?? prog?.totalBytes ?? 0)

  return (
    <main className="max-w-xl mx-auto p-6 space-y-4">
      <h1 className="text-2xl font-bold">دانلود YouTube با yt-dlp</h1>

      <form onSubmit={onSubmit} className="space-y-3">
        <input
          type="url"
          required
          placeholder="مثلاً https://www.youtube.com/watch?v=..."
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          className="w-full border rounded p-3"
        />
        <button disabled={loading} className="px-4 py-2 rounded bg-black text-white disabled:opacity-50">
          {loading ? 'در حال دانلود...' : 'دانلود'}
        </button>
      </form>

      {title && <div className="text-sm">عنوان: <strong>{title}</strong></div>}

      {(prog || totalBytes) && (
        <div className="mt-2 space-y-2">
          <div className="w-full bg-gray-200 rounded h-3 overflow-hidden">
            <div className="bg-green-600 h-3" style={{ width: `${Math.min(100, Math.max(0, percent)).toFixed(1)}%` }} />
          </div>
          <div className="text-sm text-gray-700">
            {percent.toFixed(1)}% — {downloaded} / {total}
            {prog?.speed ? <> — سرعت: {prog.speed}</> : null}
            {prog?.eta ? <> — زمان باقیمانده: {prog.eta}</> : null}
          </div>
        </div>
      )}

      {files.length > 0 && (
        <div className="mt-4">
          <h2 className="font-semibold mb-2">فایل‌های آمادهٔ دانلود</h2>
          <ul className="space-y-2">
            {files.map((f, i) => (
              <li key={i} className="flex items-center justify-between border rounded p-2">
                <div className="text-sm">
                  <div className="font-medium">{f.filename}</div>
                  <div className="text-gray-600">{formatBytes(f.sizeBytes)}</div>
                </div>
                <a href={f.downloadUrl} className="underline">دانلود</a>
              </li>
            ))}
          </ul>
        </div>
      )}

      {error && <p className="text-red-600">{error}</p>}

      {downloadUrl && files.length === 0 && (
        <a href={downloadUrl} className="mt-4 inline-block underline">دریافت فایل</a>
      )}

      <p className="text-sm text-gray-500">
        فقط لینک‌های یوتیوب مجاز است. لینک‌ها یک‌بارمصرف‌اند و پس از دانلود حذف می‌شوند.
      </p>
    </main>
  )
}
