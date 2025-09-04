# ---------- build stage ----------
FROM node:22-bullseye AS build
WORKDIR /app

# نصب دیپندنسی‌ها برای بیلد
COPY package*.json ./
RUN npm ci

# کد پروژه
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build


# ---------- runtime stage ----------
FROM node:22-bullseye AS runtime

# فقط نیازهای لازم (بدون ffmpeg؛ از ffmpeg-static استفاده می‌کنیم)
RUN apt-get update --fix-missing \
  && apt-get install -y --no-install-recommends ca-certificates curl \
  && rm -rf /var/lib/apt/lists/* \
  && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp \
       -o /usr/local/bin/yt-dlp \
  && chmod +x /usr/local/bin/yt-dlp

WORKDIR /app

# فقط فایل‌های لازم برای حالت standalone
COPY --from=build /app/public ./public
COPY --from=build /app/.next/standalone ./
COPY --from=build /app/.next/static ./.next/static

ENV NODE_ENV=production \
    DOWNLOAD_DIR=/data/downloads \
    YTDLP_PATH=/usr/local/bin/yt-dlp

RUN mkdir -p /data/downloads
VOLUME ["/data/downloads"]

EXPOSE 3000
CMD ["node", "server.js"]
