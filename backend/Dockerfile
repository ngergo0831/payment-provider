# syntax=docker/dockerfile:1

# ---- build: needs the dev dependencies (TypeScript, Nest CLI) ----
FROM node:22-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY tsconfig.json tsconfig.build.json nest-cli.json ./
COPY src ./src
RUN npm run build

# ---- runtime: production dependencies and the compiled code only ----
FROM node:22-alpine AS runtime
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force
COPY --from=build /app/dist ./dist

# Not root: if the app were ever compromised, it could not change the container's files.
USER node
EXPOSE 3000

# "Started" is not "ready": /health answers 200 only when the database is reachable. (Alpine has no curl.)
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/health').then(r => process.exit(r.ok ? 0 : 1), () => process.exit(1))"

# NODE_ENV is NOT set here: the deployment must set it, or the app refuses to start (production refuses the mock
# provider and the example JWT secret, and does not serve Swagger).
CMD ["node", "dist/main.js"]
