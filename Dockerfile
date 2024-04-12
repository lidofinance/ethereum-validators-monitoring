FROM node:18.20.1-alpine as building

WORKDIR /app

COPY package.json yarn.lock build-info.json ./
RUN yarn install --frozen-lockfile --non-interactive

COPY ./tsconfig*.json ./
COPY ./src ./src
RUN yarn build

FROM node:18.20.1-alpine

WORKDIR /app

COPY --from=building /app/dist ./dist
COPY --from=building /app/node_modules ./node_modules
COPY ./package.json ./
RUN mkdir -p ./docker/validators/ && chown -R node:node ./docker/validators/

USER node

HEALTHCHECK --interval=60s --timeout=10s --retries=3 \
  CMD sh -c "wget -nv -t1 --spider http://localhost:$HTTP_PORT/health" || exit 1

CMD ["yarn", "start:prod"]
