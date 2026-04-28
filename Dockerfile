FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json turbo.json ./
COPY apps/query-service/package.json apps/query-service/package.json
COPY apps/ws-service/package.json apps/ws-service/package.json
COPY packages/types/package.json packages/types/package.json
COPY packages/sdk/package.json packages/sdk/package.json
COPY packages/sdk-react/package.json packages/sdk-react/package.json
COPY libs/auth/package.json libs/auth/package.json
COPY libs/redis/package.json libs/redis/package.json

RUN npm ci

COPY . .
RUN npm run build

FROM node:20-alpine AS query-service

WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3000
CMD ["node", "apps/query-service/dist/main.js"]

FROM node:20-alpine AS ws-service

WORKDIR /app
COPY --from=build /app /app
ENV NODE_ENV=production
EXPOSE 3001
CMD ["node", "apps/ws-service/dist/apps/ws-service/src/main.js"]
