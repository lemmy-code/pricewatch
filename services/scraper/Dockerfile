FROM node:20-slim

# Install Chromium dependencies
RUN apt-get update && apt-get install -y \
    chromium \
    fonts-liberation \
    libnss3 \
    libatk-bridge2.0-0 \
    libdrm2 \
    libxkbcommon0 \
    libgbm1 \
    libasound2 \
    --no-install-recommends \
    && rm -rf /var/lib/apt/lists/*

# Tell Puppeteer to use system Chromium
ENV PUPPETEER_SKIP_CHROMIUM_DOWNLOAD=true
ENV PUPPETEER_EXECUTABLE_PATH=/usr/bin/chromium

WORKDIR /app

# Copy shared types
COPY shared/ /app/shared/

# Copy service files
COPY services/scraper/package*.json ./services/scraper/
RUN cd services/scraper && npm ci

COPY services/scraper/ ./services/scraper/

# Generate Prisma client
RUN cd services/scraper && npx prisma generate

WORKDIR /app/services/scraper

CMD ["npx", "tsx", "src/index.ts"]
