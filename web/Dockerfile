#   docker build -t avw-web --build-context content=content web/
# Build on Debian (Node's own image); run on Google's distroless Node, which has Node and little else: no shell, no package
# manager, no npm, and a non-root user. Neither is Ubuntu.
FROM node:24-trixie-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# The Features pages' committed content (content/features/, the build context named "content"), bundled into the site: the
# app finds it at ../content, as it does in the repository.
COPY --from=content features /content/features
RUN npm run build

# The server bundle is self-contained, so the runtime image needs no node_modules. The image's entry point is `node`, so CMD is
# just the script.
FROM gcr.io/distroless/nodejs24-debian13:nonroot AS runtime
WORKDIR /app
ENV NODE_ENV=production PORT=4000
COPY --from=build /app/dist/web ./dist/web
# Numeric, so that Kubernetes can check `runAsNonRoot` (it cannot for a name).
USER 65532:65532
EXPOSE 4000
# NG_ALLOWED_HOSTS (public host name) and API_INTERNAL_URL are supplied at deploy time.
CMD ["dist/web/server/server.mjs"]
