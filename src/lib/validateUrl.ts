export function validateYoutubeUrl(input: string): URL {
    let url: URL
    try { url = new URL(input) } catch { throw new Error('URL نامعتبر است') }
    const host = url.hostname.replace(/^www\./, '')
    const allowed = new Set([
        'youtube.com', 'youtu.be', 'm.youtube.com', 'music.youtube.com'
    ])
    if (!allowed.has(host)) {
        throw new Error('فقط لینک‌های YouTube مجاز است')
    }
    return url
}