#   docker build -t avw-web web/
FROM node:24-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
RUN npm run build

# The server bundle is self-contained, so the runtime image needs no node_modules.
FROM node:24-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/dist/web ./dist/web
USER node
EXPOSE 4000
# NG_ALLOWED_HOSTS (public host name) and API_INTERNAL_URL are supplied at deploy time.
CMD ["node", "dist/web/server/server.mjs"]
