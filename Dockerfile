FROM node:20.20.0-alpine AS building

WORKDIR /app

COPY package.json yarn.lock build-info.json ./
RUN yarn install --frozen-lockfile --non-interactive

COPY ./tsconfig*.json ./
COPY ./src ./src
RUN yarn build

# Its own stage so that editing src does not reinstall production dependencies: this install is
# keyed on the manifests alone, while the build stage's is invalidated by every source change.
FROM node:20.20.0-alpine AS prod-deps

WORKDIR /app

COPY package.json yarn.lock ./
# yarn 1 --production keeps packages only devDependencies reached (typescript, 23 MB); npm refuses
# the tree yarn accepts without --legacy-peer-deps, the @lido-nestjs packages pin Nest 8 as a peer.
RUN yarn install --frozen-lockfile --non-interactive --production \
  && npm prune --omit=dev --legacy-peer-deps \
  && yarn cache clean

FROM node:20.20.0-alpine

WORKDIR /app

COPY --from=building /app/dist ./dist
COPY --from=prod-deps /app/node_modules ./node_modules
COPY ./package.json ./
RUN mkdir -p ./docker/validators/ && chown -R node:node ./docker/validators/

USER node

HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD sh -c "wget -nv -t1 --spider http://localhost:$HTTP_PORT/health" || exit 1

# Through yarn on purpose: APP_NAME reads npm_package_name, and it is what prefixes every metric
# name. Started as `node dist/src/main`, the process comes up with the prefix missing.
CMD ["yarn", "start:prod"]
