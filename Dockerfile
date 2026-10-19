# Base build stage
FROM node:20-alpine AS builder

WORKDIR /app

COPY package*.json tsconfig.json ./
RUN npm ci

COPY src/ ./src/
RUN npm run build

# Production runtime stage
FROM node:20-alpine AS runner

WORKDIR /app
ENV NODE_ENV=production

COPY package*.json ./
RUN npm ci --omit=dev

COPY --from=builder /app/dist ./dist

# Create persistent storage directories
RUN mkdir -p session_auth uploads && chown -R node:node /app

USER node

EXPOSE 3000

VOLUME ["/app/session_auth"]

CMD ["node", "dist/index.js"]
