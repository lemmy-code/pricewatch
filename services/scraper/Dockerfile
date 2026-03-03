FROM node:20-alpine

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
