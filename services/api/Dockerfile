FROM node:20-alpine

WORKDIR /app

# Copy shared types
COPY shared/ /app/shared/

# Copy service files
COPY services/api/package*.json ./services/api/
RUN cd services/api && npm ci

COPY services/api/ ./services/api/

# Generate Prisma client
RUN cd services/api && npx prisma generate

WORKDIR /app/services/api

EXPOSE 3000
CMD ["npx", "tsx", "src/index.ts"]
