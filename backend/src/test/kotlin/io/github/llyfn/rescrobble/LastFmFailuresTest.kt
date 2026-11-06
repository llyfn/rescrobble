package io.github.llyfn.rescrobble

import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.request.HttpResponseData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.io.IOException
import kotlin.test.Test
import kotlin.test.assertEquals

class LastFmFailuresTest {
    private val clock = TestClock()
    private val hourAgo = clock.now.epochSecond - 3600

    /** Signs in normally, then answers every other Last.fm call with [reply]. */
    private fun lastFm(reply: MockRequestHandleScope.(method: String, form: Parameters) -> HttpResponseData) =
        LastFmFake { method, form ->
            if (method == "auth.getSession") lastFmJson(sessionJson("rj", "session-key-123")) else reply(method, form)
        }

    private suspend fun ApplicationTestBuilder.bearer(): String {
        val body = browser().post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"approval"}""")
        }.bodyAsText()
        return "Bearer " + Json.parseToJsonElement(body).jsonObject.getValue("token").jsonPrimitive.content
    }

    private suspend fun ApplicationTestBuilder.submitOne(): HttpResponse {
        val auth = bearer()
        return browser().post("/api/scrobbles") {
            header(HttpHeaders.Authorization, auth)
            contentType(ContentType.Application.Json)
            setBody("""{"scrobbles":[{"artist":"Cher","track":"Believe","timestamp":$hourAgo}]}""")
        }
    }

    private suspend fun ApplicationTestBuilder.me(): HttpResponse {
        val auth = bearer()
        return browser().get("/api/me") { header(HttpHeaders.Authorization, auth) }
    }

    private suspend fun HttpResponse.assertRetryLater() {
        assertEquals(HttpStatusCode.ServiceUnavailable, status)
        assertEquals("60", headers[HttpHeaders.RetryAfter])
        assertEquals("""{"error":"lastFmUnavailable"}""", bodyAsText())
    }

    @Test
    fun `Last fm rate limiting a submission asks the client to retry later`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> lastFmError(29, "Rate limit exceeded") }.engine,
        clock = clock,
    ) {
        submitOne().assertRetryLater()
    }

    @Test
    fun `a Last fm server error during submission asks the client to retry later`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> lastFmJson("<html>Internal Server Error</html>", HttpStatusCode.InternalServerError) }.engine,
        clock = clock,
    ) {
        submitOne().assertRetryLater()
    }

    @Test
    fun `Last fm reporting itself offline during submission asks the client to retry later`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> lastFmError(11, "Service Offline - This service is temporarily offline. Try again later.") }.engine,
        clock = clock,
    ) {
        submitOne().assertRetryLater()
    }

    @Test
    fun `Last fm being unreachable during submission asks the client to retry later`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> throw IOException("connection reset") }.engine,
        clock = clock,
    ) {
        submitOne().assertRetryLater()
    }

    @Test
    fun `a revoked session during submission means signing in again`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> lastFmError(9, "Invalid session key - Please re-authenticate") }.engine,
        clock = clock,
    ) {
        val response = submitOne()

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals("""{"error":"sessionInvalid"}""", response.bodyAsText())
    }

    @Test
    fun `me asks Last fm about the session itself`() {
        val lastFm = lastFm { _, _ -> lastFmJson(userInfoJson("rj")) }
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            me()

            val form = lastFm.requests.map { it.second }.single { it["method"] == "user.getInfo" }
            assertEquals("session-key-123", form["sk"])
            assertEquals(null, form["user"])
            assertEquals(
                LastFmClient.signature(
                    mapOf("method" to "user.getInfo", "api_key" to "test-api-key", "sk" to "session-key-123"),
                    "test-shared-secret",
                ),
                form["api_sig"],
            )
        }
    }

    @Test
    fun `me reports a revoked session as signed out`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> lastFmError(9, "Invalid session key - Please re-authenticate") }.engine,
        clock = clock,
    ) {
        val response = me()

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals("""{"error":"sessionInvalid"}""", response.bodyAsText())
    }

    @Test
    fun `me still answers from the session when Last fm is down`() = rescrobbleTest(
        lastFm = lastFm { _, _ -> throw IOException("connection reset") }.engine,
        clock = clock,
    ) {
        val response = me()

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("""{"username":"rj","pro":null}""", response.bodyAsText())
    }
}
