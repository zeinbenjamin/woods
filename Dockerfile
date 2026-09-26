# better-sqlite3 compiles a native module, so build it in a stage with the
# toolchain and copy only the result into the runtime image.
FROM node:22-bookworm-slim AS build
WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends python3 make g++ && rm -rf /var/lib/apt/lists/*
COPY package.json ./
RUN npm install --omit=dev

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production DATA_DIR=/data PORT=1818
COPY --from=build /app/node_modules ./node_modules
COPY package.json ./
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
# Stamped by the publish workflow so the running app can say exactly which
# commit it is. Declared last so they don't bust the layer cache above.
ARG CARRY_COMMIT=""
ARG CARRY_BUILT=""
ENV CARRY_COMMIT=$CARRY_COMMIT CARRY_BUILT=$CARRY_BUILT
CMD ["node", "server/index.js"]
