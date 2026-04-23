# syntax=docker/dockerfile:1.7
# ---------------------------------------------------------------------------
# Image pinning REQUIRED for production.
# Replace each FROM node:22-alpine line below with a digest-pinned form, e.g.:
#   FROM node:22-alpine@sha256:<digest> AS deps
# All three stages MUST use the same digest. See
# docs/operations/image-pinning.md and scripts/pin-images.sh.
# ---------------------------------------------------------------------------

FROM node:22-alpine AS deps
# pin: node:22-alpine  (replace with @sha256:<digest> before prod build)

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

FROM node:22-alpine AS builder
# pin: node:22-alpine  (MUST match the deps stage digest)

WORKDIR /app

ARG APP_ENV=production
ARG NEXT_PUBLIC_APP_ENV=production
ARG NEXT_PUBLIC_API_URL
ARG INTERNAL_API_URL

ENV APP_ENV=$APP_ENV
ENV NEXT_PUBLIC_APP_ENV=$NEXT_PUBLIC_APP_ENV
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL
ENV INTERNAL_API_URL=$INTERNAL_API_URL

COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:22-alpine AS runner
# pin: node:22-alpine  (MUST match the deps/builder stage digest)

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1

RUN addgroup -S app && adduser -S app -G app

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY --from=builder --chown=app:app /app/.next ./.next
COPY --from=builder --chown=app:app /app/public ./public
COPY --from=builder --chown=app:app /app/next.config.ts ./next.config.ts

USER app

RUN mkdir -p /app/.next/cache/images

CMD ["npm", "run", "start"]