# better-sqlite3 compiles a native module, so build it in a stage with the
# toolchain and copy only the result into the runtime image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=1818
COPY --from=build /app/node_modules ./node_modules
COPY package.json CHANGELOG.md ./
COPY server ./server
COPY web ./web
COPY scripts ./scripts
# No USER here on purpose: the runtime user comes from compose, because
# it has to match the host dataset's owner (568:568 on TrueNAS SCALE).
# /data is created world-writable so any uid can initialise the database;
# the bind mount's own permissions take over once it's attached.
RUN mkdir -p /data && chmod 777 /data
VOLUME ["/data"]
EXPOSE 1818
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:1818/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
# The commit this image was built from, shown in the app's version sheet.
# Late on purpose: it changes every commit, so nothing after it can be cached.
ARG APP_COMMIT=dev
ENV APP_COMMIT=$APP_COMMIT
CMD ["node", "server/index.js"]
