FROM node:20-alpine

WORKDIR /app

# Copy shared types
COPY shared/ /app/shared/

# Copy service files
COPY services/notification/package*.json ./services/notification/
RUN cd services/notification && npm ci

COPY services/notification/ ./services/notification/

WORKDIR /app/services/notification

CMD ["npx", "tsx", "src/index.ts"]
