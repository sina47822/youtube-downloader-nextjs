FROM node:22-bullseye as base


# نصب Python و yt-dlp
RUN apt-get update && apt-get install -y python3-pip && rm -rf /var/lib/apt/lists/* \
&& python3 -m pip install --no-cache-dir yt-dlp


WORKDIR /app
COPY package*.json .
RUN npm ci --omit=dev
COPY . .
RUN npm run build


ENV NODE_ENV=production \
DOWNLOAD_DIR=/data/downloads


# پوشه‌ی دانلودها
RUN mkdir -p /data/downloads
VOLUME ["/data/downloads"]


EXPOSE 3000
CMD ["npm", "start"]