FROM node:20.20.0-alpine AS building

WORKDIR /app

COPY package.json yarn.lock build-info.json ./
RUN yarn install --frozen-lockfile --non-interactive

COPY ./tsconfig*.json ./
COPY ./src ./src
RUN yarn build

# Separate from the build stage rather than pruned after it: a prune leaves the devDependency tree
# in the layer it is pruned from, and the runtime image copies layers, not the final filesystem.
FROM node:20.20.0-alpine AS prod-deps

WORKDIR /app

COPY package.json yarn.lock ./
# The prune is not redundant: yarn 1 --production drops the root's devDependencies but keeps
# packages only those reached — typescript, 23 MB of it, stayed behind. --legacy-peer-deps because
# npm otherwise refuses a tree yarn accepts: the @lido-nestjs packages pin Nest 8 as a peer.
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
