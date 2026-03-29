FROM node:alpine AS node-builder

WORKDIR /backend

COPY package*.json .
RUN npm install

COPY . .
RUN npm run build

FROM registry.heroiclabs.com/heroiclabs/nakama:3.22.0

# Install runtime bundle + config (paths match heroiclabs/nakama image layout).
COPY --from=node-builder /backend/build/*.js /nakama/data/modules/build/
COPY local.yml /nakama/data/

# Keep entrypoint at a fixed root path (avoids missing file if /nakama layout differs on some hosts).
COPY docker-entrypoint.sh /docker-entrypoint.sh
RUN chmod +x /docker-entrypoint.sh

# Nakama listens on these (same as heroiclabs/nakama image). `EXPOSE` documents intent; host publishing is usually done in compose with `ports:`.
EXPOSE 7349 7350 7351

# Migrate first, then server (see docker-entrypoint.sh). Set DATABASE_URL or NAKAMA_DATABASE_ADDRESS.
# Invoke via /bin/sh so the script runs even if the exec bit is stripped by a bad checkout/build.
ENTRYPOINT ["/bin/sh", "/docker-entrypoint.sh"]
