FROM eclipse-temurin:25-jdk AS backend
WORKDIR /src
COPY backend/ .
RUN ./gradlew installDist --no-daemon --console=plain

FROM eclipse-temurin:25-jre
RUN useradd --system --no-create-home rescrobble
WORKDIR /app
COPY --from=backend /src/build/install/rescrobble-backend/ /app/
COPY backend/web-placeholder/ /app/web/
ENV WEB_APP_DIR=/app/web \
    PORT=8080
EXPOSE 8080
USER rescrobble
CMD ["/app/bin/rescrobble-backend"]
