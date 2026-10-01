FROM node:20-slim

# Install Chromium, FFmpeg and dependencies for faststart video remuxing and headless browser
RUN apt-get update && apt-get install -y \
    chromium \
    ffmpeg \
    ca-certificates \
    fonts-liberation \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_PATH=/usr/bin/chromium
ENV PORT=8000
ENV BOT_TOKEN=7876010393:AAG9n6VlIGjTrDlAkxXnlxvOyGxe34BzS5M
ENV WEB_PLAYER_BASE_URL=https://bewildered-fae-teralinks-1c3a87c2.koyeb.app

WORKDIR /app

COPY package*.json ./
RUN npm install --omit=dev

COPY . .

EXPOSE 8000

CMD ["node", "bot.mjs"]
