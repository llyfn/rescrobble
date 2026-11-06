package io.github.llyfn.rescrobble

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.plugins.defaultRequest
import io.ktor.client.request.header
import io.ktor.client.engine.mock.respondError
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.server.testing.ApplicationTestBuilder
import io.ktor.server.testing.testApplication
import java.time.Clock
import java.time.Duration
import java.time.Instant
import java.time.ZoneId
import java.time.ZoneOffset

val testEnvironment = mapOf(
    "LASTFM_API_KEY" to "test-api-key",
    "LASTFM_SHARED_SECRET" to "test-shared-secret",
    "SESSION_ENCRYPTION_KEY" to "AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=",
    "PUBLIC_BASE_URL" to "https://rescrobble.test",
    "EXTENSION_ID" to "testextensionid",
)

class TestClock(var now: Instant = Instant.parse("2026-01-15T12:00:00Z")) : Clock() {
    fun advance(duration: Duration) {
        now += duration
    }

    override fun instant(): Instant = now
    override fun getZone(): ZoneId = ZoneOffset.UTC
    override fun withZone(zone: ZoneId): Clock = throw UnsupportedOperationException()
}

/** Fails any Last.fm call a test didn't script, so unexpected calls surface as errors. */
fun unscriptedLastFm() = MockEngine { respondError(HttpStatusCode.NotImplemented) }

fun rescrobbleTest(
    lastFm: MockEngine = unscriptedLastFm(),
    clock: TestClock = TestClock(),
    config: Config = Config.fromEnvironment(testEnvironment),
    block: suspend ApplicationTestBuilder.() -> Unit,
) = testApplication {
    application { module(config, lastFm, clock) }
    block()
}

/**
 * A browser on the Web App's own pages: redirects stay visible, requests arrive over https as they
 * would through the production proxy, and they carry the Web App's origin.
 */
fun ApplicationTestBuilder.browser(origin: String? = "https://rescrobble.test") = createClient {
    followRedirects = false
    defaultRequest {
        header("X-Forwarded-Proto", "https")
        origin?.let { header(HttpHeaders.Origin, it) }
    }
}
