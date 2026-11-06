package io.github.llyfn.rescrobble

import ch.qos.logback.classic.Logger
import ch.qos.logback.classic.spi.ILoggingEvent
import ch.qos.logback.classic.spi.ThrowableProxyUtil
import ch.qos.logback.core.read.ListAppender
import io.ktor.client.request.cookie
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.http.parseServerSetCookieHeader
import org.slf4j.LoggerFactory
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertTrue

class SecretsInLogsTest {
    private val root = LoggerFactory.getLogger(Logger.ROOT_LOGGER_NAME) as Logger
    private val appender = ListAppender<ILoggingEvent>()

    @BeforeTest
    fun capture() {
        appender.start()
        root.addAppender(appender)
    }

    @AfterTest
    fun release() {
        root.detachAppender(appender)
    }

    private fun capturedText() = appender.list.joinToString("\n") { event ->
        event.formattedMessage + event.throwableProxy?.let { "\n" + ThrowableProxyUtil.asString(it) }.orEmpty()
    }

    @Test
    fun `Web App and Extension sign-in, me and logout never log tokens, session keys or the shared secret`() = rescrobbleTest(
        lastFm = LastFmFake { _, form ->
            if (form["token"] == "secret-token-ok") lastFmJson(sessionJson("rj", "secret-session-key"))
            else lastFmError(4, "Invalid authentication token supplied")
        }.engine,
    ) {
        val client = browser()
        val setCookie = client.get("/auth/callback?token=secret-token-ok").headers.getAll(HttpHeaders.SetCookie)!!
        val cookie = parseServerSetCookieHeader(setCookie.single())
        client.get("/api/me") { cookie(cookie.name, cookie.value) }
        client.post("/auth/logout") { cookie(cookie.name, cookie.value) }
        client.get("/auth/callback?token=secret-token-bad")

        val exchanged = client.post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"secret-token-ok"}""")
        }.bodyAsText()
        val rescrobbleToken = exchanged.substringAfter("\"token\":\"").substringBefore('"')
        client.get("/api/me") { header(HttpHeaders.Authorization, "Bearer $rescrobbleToken") }
        client.post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"secret-token-bad"}""")
        }

        val logs = capturedText()
        val secrets = listOf("secret-token-ok", "secret-token-bad", "secret-session-key", "test-shared-secret", rescrobbleToken)
        for (secret in secrets) {
            assertTrue(secret !in logs, "'$secret' appeared in logs")
        }
    }
}
