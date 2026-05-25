FROM node:20-alpine AS builder

WORKDIR /build
RUN apk add --no-cache python3 make g++

COPY server/package*.json ./
RUN npm install --omit=dev --no-audit --no-fund

FROM node:20-alpine

LABEL org.opencontainers.image.title="Moje meteo"
LABEL org.opencontainers.image.description="Self-hosted Ecowitt pocasie PWA"

RUN apk add --no-cache tini wget && \
    addgroup -S app && adduser -S -G app app && \
    mkdir -p /data && chown -R app:app /data

WORKDIR /app
COPY --from=builder /build/node_modules ./node_modules
# .dockerignore vylučuje server/node_modules z Windows
COPY server/ ./
RUN chown -R app:app /app

USER app

ENV NODE_ENV=production
ENV PORT=8081
ENV DB_PATH=/data/meteo.db

EXPOSE 8081
VOLUME ["/data"]

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s \
  CMD wget -qO- http://localhost:8081/api/config >/dev/null || exit 1

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "server.js"]
