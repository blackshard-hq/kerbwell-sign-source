###########################
#     BASE CONTAINER      #
###########################
FROM node:22-alpine3.22 AS base

RUN apk add --no-cache openssl
RUN apk add --no-cache font-freefont


###########################
#    BUILDER CONTAINER    #
###########################
FROM base AS builder

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
RUN apk add --no-cache jq
WORKDIR /app

COPY . .

RUN npm install -g "turbo@^2.10.0"

# Outputs to the /out folder
# source: https://turbo.build/repo/docs/reference/command-line-reference/prune#--docker
RUN turbo prune --scope=@documenso/remix --docker

###########################
#   INSTALLER CONTAINER   #
###########################
FROM base AS installer

# Check https://github.com/nodejs/docker-node/tree/b4117f9333da4138b03a546ec926ef50a31506c3#nodealpine to understand why libc6-compat might be needed.
RUN apk add --no-cache libc6-compat
RUN apk add --no-cache jq
# Required for node_modules/aws-crt
RUN apk add --no-cache make cmake g++ openssl bash

WORKDIR /app

# Disable husky from installing hooks
ENV HUSKY 0
ENV DOCKER_OUTPUT 1
ENV NEXT_TELEMETRY_DISABLED 1

# Encryption keys
ARG NEXT_PRIVATE_ENCRYPTION_KEY="CAFEBABE"
ENV NEXT_PRIVATE_ENCRYPTION_KEY="$NEXT_PRIVATE_ENCRYPTION_KEY"

ARG NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY="DEADBEEF"
ENV NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY="$NEXT_PRIVATE_ENCRYPTION_SECONDARY_KEY"

# Telemetry credentials (optional, baked into image at build time)
ARG NEXT_PRIVATE_TELEMETRY_KEY=""
ENV NEXT_PRIVATE_TELEMETRY_KEY="$NEXT_PRIVATE_TELEMETRY_KEY"

ARG NEXT_PRIVATE_TELEMETRY_HOST=""
ENV NEXT_PRIVATE_TELEMETRY_HOST="$NEXT_PRIVATE_TELEMETRY_HOST"


# Uncomment and use build args to enable remote caching
# ARG TURBO_TEAM
# ENV TURBO_TEAM=$TURBO_TEAM
# ARG TURBO_TOKEN
# ENV TURBO_TOKEN=$TURBO_TOKEN

# First install the dependencies (as they change less often)
COPY .gitignore .gitignore
COPY --from=builder /app/out/json/ .
COPY --from=builder /app/out/package-lock.json ./package-lock.json

COPY --from=builder /app/lingui.config.ts ./lingui.config.ts
COPY --from=builder /app/patches ./patches

RUN npm ci

# Then copy all the source code (as it changes more often)
COPY --from=builder /app/out/full/ .
# Finally copy the turbo.json file so that we can run turbo commands
COPY turbo.json turbo.json

RUN npm install -g "turbo@^2.10.0"

RUN turbo run build --filter=@documenso/remix...

###########################
#     RUNNER CONTAINER    #
###########################
# The app without its corresponding-source link. Never ship this stage on its own: the default
# target (`runner`, at the end of this file) adds the link and fails without it. CI builds
# `--target unpublished` only to check the image still compiles on a pull request.
FROM base AS unpublished

ENV HUSKY 0
ENV DOCKER_OUTPUT 1

# Telemetry credentials (baked into image at build time, can be disabled at runtime)
ARG NEXT_PRIVATE_TELEMETRY_KEY=""
ENV NEXT_PRIVATE_TELEMETRY_KEY="$NEXT_PRIVATE_TELEMETRY_KEY"

ARG NEXT_PRIVATE_TELEMETRY_HOST=""
ENV NEXT_PRIVATE_TELEMETRY_HOST="$NEXT_PRIVATE_TELEMETRY_HOST"

# Don't run production as root
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nodejs

USER nodejs

WORKDIR /app

COPY --from=builder --chown=nodejs:nodejs /app/out/json/ .
# Copy the tailwind config files across
COPY --from=builder --chown=nodejs:nodejs /app/out/full/packages/tailwind-config ./packages/tailwind-config
# Copy the patches across
COPY --from=builder --chown=nodejs:nodejs /app/patches ./patches

RUN npm ci --only=production

# Automatically leverage output traces to reduce image size
# https://nodejs.org/docs/advanced-features/output-file-tracing
COPY --from=installer --chown=nodejs:nodejs /app/apps/remix/build ./apps/remix/build
COPY --from=installer --chown=nodejs:nodejs /app/apps/remix/public ./apps/remix/public

# Copy the prisma binary, schema and migrations
COPY --from=installer --chown=nodejs:nodejs /app/packages/prisma/schema.prisma ./packages/prisma/schema.prisma
COPY --from=installer --chown=nodejs:nodejs /app/packages/prisma/migrations ./packages/prisma/migrations

# Generate the prisma client again
RUN npx prisma generate --schema ./packages/prisma/schema.prisma

# Black Shard, Essential Eight ML3: the npm CLI bundled in the node base image
# ships a vulnerable tar at /usr/local/lib/node_modules/npm/node_modules/tar
# (CVE-2026-59873, tar 7.5.11 against a fixed 7.5.19). This Dockerfile pins
# node:22-alpine3.22, so a plain rebuild never clears it; installing a current
# npm over the bundled one does, and it holds across rebuilds on the pin. It
# runs last in the runtime stage so every npm ci and prisma step above is
# unaffected by the change. Review this pin when npm publishes a security
# release. 16 Oct 2026: 12.0.2 to 12.2.1, which bundles tar 7.5.22, undici
# 6.29.0, ip-address 10.7.2 and brace-expansion 5.0.12 (CVE-2026-73566,
# CVE-2026-19534, CVE-2026-69192, CVE-2026-102276, CVE-2026-102278).
USER root
RUN npm install -g npm@12.2.1 \
    && npm --version
USER nodejs


# Get the start script from docker/
COPY --chown=nodejs:nodejs ./docker/start.sh /app/apps/remix/start.sh
# Migrations without the database URL on argv (BS-A670); start.sh runs it.
COPY --chown=nodejs:nodejs ./docker/prisma-migrate-deploy.mjs /app/apps/remix/prisma-migrate-deploy.mjs
# Kerbwell Sign: the one-shot setup job (admin, organisation, team, API token, webhook).
COPY --chown=nodejs:nodejs ./docker/kerbwell-bootstrap.mjs /app/apps/remix/kerbwell-bootstrap.mjs

LABEL au.com.kerbwell.unpublished="true"

WORKDIR /app/apps/remix

CMD ["sh", "start.sh"]


###########################
#   SOURCE GATE (AGPL)    #
###########################
# AGPL-3.0 section 13: every shipped image carries the public URL of its own corresponding
# source. docker/kerbwell-source.sh publishes the exact tree to the public mirror first; this
# stage then refuses the build unless KERBWELL_SOURCE_URL is a mirror snapshot tag
# (https://github.com/blackshard-hq/kerbwell-sign-source/tree/src-<12 hex>) that answers 200
# to an anonymous request. An empty value, a private commit or an unpublished tag fails here,
# whichever route builds the image.
FROM base AS source-gate

ARG KERBWELL_SOURCE_URL
# Retries 5 s apart, for GitHub's short lag after a push.
ARG KERBWELL_SOURCE_ATTEMPTS=6
COPY ./docker/kerbwell-source-gate.mjs /kerbwell-source-gate.mjs
RUN node /kerbwell-source-gate.mjs "${KERBWELL_SOURCE_URL}" \
  && printf '%s\n' "${KERBWELL_SOURCE_URL}" > /kerbwell-source-url


###########################
#   RUNNER (DEFAULT)      #
###########################
FROM unpublished AS runner

ARG KERBWELL_SOURCE_URL
ARG KERBWELL_SOURCE_REVISION=""
# The copy ties this stage to the gate, so the gate runs on every build of the default target,
# BuildKit or not. The value must match the one the gate passed.
COPY --from=source-gate --chown=nodejs:nodejs /kerbwell-source-url /app/kerbwell-source-url
RUN test "$(cat /app/kerbwell-source-url)" = "${KERBWELL_SOURCE_URL}"

# A runtime BRAND_SOURCE_URL still overrides this; leave it unset so the link names the build.
ENV BRAND_SOURCE_URL=${KERBWELL_SOURCE_URL}
LABEL org.opencontainers.image.source="https://github.com/blackshard-hq/kerbwell-sign" \
      org.opencontainers.image.revision="${KERBWELL_SOURCE_REVISION}" \
      org.opencontainers.image.licenses="AGPL-3.0-only" \
      au.com.kerbwell.source-url="${KERBWELL_SOURCE_URL}" \
      au.com.kerbwell.unpublished="false"

WORKDIR /app/apps/remix

CMD ["sh", "start.sh"]
