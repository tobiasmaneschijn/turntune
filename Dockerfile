# Reviewed 2026-10-13; Dependabot proposes digest updates for review.
FROM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS build
WORKDIR /app
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --include=dev --cache /tmp/npm-cache --no-fund
COPY . .
RUN npm run build
RUN find dist-server -name '*.test.js' -delete

FROM node:26-alpine@sha256:6f08a523443ddedf52941874c203475b0ad503e859ad70cb26ab8be9a517dbd5 AS runtime
ARG BUILD_REVISION=unknown
LABEL org.opencontainers.image.title="turntune" \
      org.opencontainers.image.revision=$BUILD_REVISION
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000
COPY package*.json ./
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then export NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca; fi; \
    npm ci --omit=dev --cache /tmp/npm-cache --no-fund && \
    rm -rf /tmp/npm-cache /usr/local/lib/node_modules/npm /usr/local/lib/node_modules/corepack \
      /opt/yarn* /usr/local/bin/npm /usr/local/bin/npx /usr/local/bin/corepack \
      /usr/local/bin/yarn /usr/local/bin/yarnpkg
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
RUN chmod a+r /app/package.json /app/package-lock.json && \
    chmod -R a+rX /app/dist /app/dist-server && \
    mkdir -p /app/data && chown node:node /app/data
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=6s --start-period=20s --retries=3 CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || '3000') + '/api/ready', {signal: AbortSignal.timeout(5500)}).then(r => {if (!r.ok) process.exit(1)}).catch(() => process.exit(1))"
CMD ["node", "dist-server/server/start-production.js"]
