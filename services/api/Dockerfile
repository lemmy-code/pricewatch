FROM node:20-alpine

WORKDIR /app

# Copy shared types
COPY shared/ /app/shared/

# Copy service files
COPY services/api/package*.json ./services/api/
RUN cd services/api && npm ci --production=false

COPY services/api/ ./services/api/

# Generate Prisma client
RUN cd services/api && npx prisma generate

# Build TypeScript
RUN cd services/api && npm run build

WORKDIR /app/services/api

EXPOSE 3000
CMD ["npm", "start"]
