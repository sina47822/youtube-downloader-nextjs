import fs from 'fs'
import path from 'path'
import { randomUUID } from 'crypto'

const DEFAULT_DIR = process.env.DOWNLOAD_DIR || '/tmp/downloads'
export function getDownloadDir() {
  return DEFAULT_DIR
}
export function ensureDir(dir: string) {
  fs.mkdirSync(dir, { recursive: true })
}

type Stored = { path: string; createdAt: number; mime: string; filename?: string; sizeBytes?: number }
const files = new Map<string, Stored>()

export function putFile(f: Stored): string {
  const token = randomUUID()
  files.set(token, f)
  return token
}
export function getFileByToken(token: string): Stored | undefined {
  return files.get(token)
}
// (اختیاری) پاکسازی دوره‌ای
setInterval(() => {
  const now = Date.now()
  for (const [k, v] of files) {
    if (now - v.createdAt > 1000 * 60 * 60) { // 1h
      try { fs.unlinkSync(v.path) } catch {}
      files.delete(k)
    }
  }
}, 10 * 60 * 1000)
