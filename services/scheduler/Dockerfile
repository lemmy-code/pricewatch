FROM node:20-alpine

WORKDIR /app

# Copy shared types
COPY shared/ /app/shared/

# Copy service files
COPY services/scheduler/package*.json ./services/scheduler/
RUN cd services/scheduler && npm ci

COPY services/scheduler/ ./services/scheduler/

# Generate Prisma client
RUN cd services/scheduler && npx prisma generate

WORKDIR /app/services/scheduler

CMD ["npx", "tsx", "src/index.ts"]
