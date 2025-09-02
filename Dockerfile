# ---------- build stage ----------
FROM node:22-bullseye AS build

# yt-dlp را نصب کن (برای کپی باینری در مرحله‌ی runtime)
RUN apt-get update \
  && apt-get install -y python3-pip \
  && rm -rf /var/lib/apt/lists/* \
  && python3 -m pip install --no-cache-dir yt-dlp

WORKDIR /app

# devDeps لازمند برای build
COPY package*.json ./
RUN npm ci

COPY . .
RUN npm run build


# ---------- runtime stage ----------
FROM node:22-bullseye AS runtime

# برای remux/merge لازم است
RUN apt-get update \
  && apt-get install -y ffmpeg \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# باینری yt-dlp از استیج build
COPY --from=build /usr/local/bin/yt-dlp /usr/local/bin/yt-dlp

# خروجی Next و منابع
COPY --from=build /app/.next ./.next
COPY --from=build /app/public ./public
COPY --from=build /app/package*.json ./
COPY --from=build /app/node_modules ./node_modules

# اگر می‌خوای کوچیک‌تر بشه:
RUN npm prune --omit=dev

ENV NODE_ENV=production \
    DOWNLOAD_DIR=/data/downloads \
    YTDLP_PATH=/usr/local/bin/yt-dlp

RUN mkdir -p /data/downloads
VOLUME ["/data/downloads"]

EXPOSE 3000
CMD ["npm", "start"]
