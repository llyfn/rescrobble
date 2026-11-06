FROM node:26-slim AS web
RUN npm install --global pnpm@12.18.0
WORKDIR /src
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.base.json ./
COPY apps/web/package.json apps/web/
COPY packages/core/package.json packages/core/
COPY packages/ui/package.json packages/ui/
RUN pnpm install --frozen-lockfile
COPY apps/web/ apps/web/
COPY packages/ packages/
RUN pnpm --filter @rescrobble/web build

FROM eclipse-temurin:25-jdk AS backend
WORKDIR /src
COPY backend/ .
RUN ./gradlew installDist --no-daemon --console=plain

FROM eclipse-temurin:25-jre
RUN useradd --system --no-create-home rescrobble
WORKDIR /app
COPY --from=backend /src/build/install/rescrobble-backend/ /app/
COPY --from=web /src/apps/web/dist/ /app/web/
ENV WEB_APP_DIR=/app/web \
    PORT=8080
EXPOSE 8080
USER rescrobble
CMD ["/app/bin/rescrobble-backend"]
