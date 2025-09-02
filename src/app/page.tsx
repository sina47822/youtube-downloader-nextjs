'use client'
import { useState } from 'react'

function toErrorMessage(err: unknown): string {
  if (err instanceof Error) return err.message
  try { return JSON.stringify(err) } catch { return String(err) }
}

export default function Page() {
  const [url, setUrl] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [downloadUrl, setDownloadUrl] = useState<string | null>(null)

  async function onSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault()
    setError(null)
    setDownloadUrl(null)
    setLoading(true)
    try {
      const res = await fetch('/api/download', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url }),
      })
      const ct = res.headers.get('content-type') || ''
      const data = ct.includes('application/json') ? await res.json() : {}
      if (!res.ok || !('ok' in data)) {
        const txt = ct.includes('application/json') ? data?.error : await res.text()
        throw new Error(typeof txt === 'string' ? txt : 'خطا')
      }
      if (!data.ok) throw new Error(data.error || 'خطا')
      setDownloadUrl(data.downloadUrl as string)
    } catch (err: unknown) {
      setError(toErrorMessage(err) || 'خطای ناشناخته')
    } finally {
      setLoading(false)
    }
  }

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
