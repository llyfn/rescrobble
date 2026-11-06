package io.github.llyfn.rescrobble

import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.engine.cio.CIO
import io.ktor.serialization.kotlinx.json.json
import io.ktor.server.application.Application
import io.ktor.server.application.ApplicationStopped
import io.ktor.server.application.install
import io.ktor.server.engine.embeddedServer
import io.ktor.server.netty.Netty
import io.ktor.server.plugins.contentnegotiation.ContentNegotiation
import io.ktor.server.plugins.forwardedheaders.XForwardedHeaders
import io.ktor.server.response.respondText
import io.ktor.server.routing.get
import io.ktor.server.routing.routing
import io.ktor.server.sessions.Sessions
import io.ktor.server.sessions.cookie
import kotlinx.serialization.json.Json
import java.time.Clock
import kotlin.system.exitProcess
import kotlin.time.Duration.Companion.days

const val SESSION_COOKIE = "rescrobble_session"

fun main() {
    val config = try {
        Config.fromEnvironment(System.getenv())
    } catch (e: IllegalStateException) {
        System.err.println(e.message)
        exitProcess(1)
    }
    embeddedServer(Netty, port = config.port) {
        module(config, CIO.create(), Clock.systemUTC())
    }.start(wait = true)
}

fun Application.module(config: Config, lastFmEngine: HttpClientEngine, clock: Clock) {
    val lastFm = LastFmClient(lastFmEngine, config.lastFmApiKey, config.lastFmSharedSecret)
    monitor.subscribe(ApplicationStopped) { lastFm.close() }
    val sessionTransformer = AesGcmSessionTransformer(config.sessionEncryptionKey)
    val tokens = SessionTokenCodec(sessionTransformer)

    // Deployed behind a TLS-terminating proxy; the secure cookie needs the original https scheme.
    install(XForwardedHeaders)
    installCors(config)
    install(ContentNegotiation) { json(Json { classDiscriminator = "status" }) }
    install(Sessions) {
        cookie<UserSession>(SESSION_COOKIE) {
            cookie.path = "/"
            cookie.httpOnly = true
            cookie.secure = config.publicBaseUrl.startsWith("https://")
            cookie.extensions["SameSite"] = "Lax"
            // Last.fm session keys don't expire, so the cookie lasts long enough to survive between visits.
            cookie.maxAgeInSeconds = 365.days.inWholeSeconds
            transform(sessionTransformer)
        }
    }

    routing {
        get("/health") { call.respondText("ok") }
        authRoutes(config, lastFm, tokens)
        apiRoutes(lastFm, tokens)
        scrobbleRoutes(config, lastFm, tokens, RateLimiter(clock), clock)
    }
}
