# ─────────────────────────────────────────────
# Stage 1: Build React UI
# ─────────────────────────────────────────────
FROM node:20-alpine AS ui-builder

WORKDIR /ui
COPY ui/package.json ./
RUN npm install
COPY ui/ ./
RUN npm run build

# ─────────────────────────────────────────────
# Stage 2: Portal runtime
# ─────────────────────────────────────────────
FROM node:20-alpine

LABEL org.opencontainers.image.title="bootstrap-hci Management Portal"
LABEL org.opencontainers.image.description="Management portal to launch, monitor, and manage bootstrap-hci clusters"

ARG TARGETARCH=amd64

# kubectl for CMP deployment — arch-specific
RUN apk add --no-cache curl && \
    curl -fsSLo /usr/local/bin/kubectl \
        https://dl.k8s.io/release/v1.31.0/bin/linux/${TARGETARCH}/kubectl && \
    chmod +x /usr/local/bin/kubectl && \
    apk del curl

WORKDIR /app

# Install portal dependencies
COPY portal/package.json ./
RUN npm install --omit=dev

# Copy server + built UI
COPY portal/server.js ./
COPY --from=ui-builder /ui/dist ./public

# CMP manifests mount point
RUN mkdir -p /cmp /output /config

EXPOSE 3000
CMD ["node", "server.js"]
