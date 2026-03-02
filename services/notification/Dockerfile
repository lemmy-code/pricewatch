FROM node:20-alpine

WORKDIR /app

# Copy shared types
COPY shared/ /app/shared/

# Copy service files
COPY services/notification/package*.json ./services/notification/
RUN cd services/notification && npm ci --production=false

COPY services/notification/ ./services/notification/

# Build TypeScript
RUN cd services/notification && npm run build

WORKDIR /app/services/notification

CMD ["npm", "start"]
