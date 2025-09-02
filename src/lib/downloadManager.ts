import { randomBytes } from 'crypto'
import path from 'path'
import fs from 'fs'


    export type DownloadEntry = {
        path: string
        mime?: string
        createdAt: number
    }


    // نگاشت توکن به مسیر فایل روی دیسک (برای نمونه‌ی ساده؛ در تولیدی بهتر است Redis/DB)
    const store = new Map<string, DownloadEntry>()


    export function makeToken() {
        return randomBytes(16).toString('hex')
    }


    export function putFile(entry: DownloadEntry) {
        const token = makeToken()
        store.set(token, entry)
        return token
    }


    export function takeFile(token: string) {
        const entry = store.get(token)
        if (entry) store.delete(token)
        return entry
    }


    // پاکسازی دوره‌ای فایل‌های قدیمی (اختیاری)
    const TTL_MS = 60 * 60 * 1000 // 1 ساعت
    setInterval(() => {
            const now = Date.now()
            for (const [t, e] of store) {
            if (now - e.createdAt > TTL_MS) {
            try { fs.unlinkSync(e.path) } catch {}
            store.delete(t)
            }
        }
    }, 15 * 60 * 1000).unref()


    export function getDownloadDir() {
        return process.env.DOWNLOAD_DIR || path.join(process.cwd(), 'downloads')
    }


    export function ensureDir(p: string) {
        if (!fs.existsSync(p)) fs.mkdirSync(p, { recursive: true })
    }