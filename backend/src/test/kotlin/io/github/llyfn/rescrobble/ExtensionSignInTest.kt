package io.github.llyfn.rescrobble

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class ExtensionSignInTest {
    private val lastFm = LastFmFake { method, form ->
        when {
            method == "auth.getSession" && form["token"] == "good-token" -> lastFmJson(sessionJson("rj", "session-key-123"))
            method == "auth.getSession" -> lastFmError(14, "Unauthorized Token - This token has not been authorized")
            method == "user.getInfo" -> lastFmJson(userInfoJson("rj"))
            else -> error("unexpected Last.fm method $method")
        }
    }

    private suspend fun ApplicationTestBuilder.exchange(approvalToken: String): HttpResponse =
        browser().post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$approvalToken"}""")
        }

    private suspend fun ApplicationTestBuilder.signIn(): String =
        Json.parseToJsonElement(exchange("good-token").bodyAsText()).jsonObject.getValue("token").jsonPrimitive.content

    @Test
    fun `a valid approval token returns the username and a rescrobble token`() = rescrobbleTest(lastFm = lastFm.engine) {
        val response = exchange("good-token")

        assertEquals(HttpStatusCode.OK, response.status)
        val body = Json.parseToJsonElement(response.bodyAsText()).jsonObject
        assertEquals("rj", body.getValue("username").jsonPrimitive.content)
        assertTrue(body.getValue("token").jsonPrimitive.content.isNotBlank())
        assertEquals(setOf("username", "token"), body.keys)
    }

    @Test
    fun `the rescrobble token does not reveal the Last fm session key`() = rescrobbleTest(lastFm = lastFm.engine) {
        val response = exchange("good-token")

        assertFalse("session-key-123" in response.bodyAsText())
    }

    @Test
    fun `the exchange sends the approval token to auth getSession`() = rescrobbleTest(lastFm = lastFm.engine) {
        exchange("good-token")

        val (_, form) = lastFm.requests.single()
        assertEquals("auth.getSession", form["method"])
        assertEquals("good-token", form["token"])
    }

    @Test
    fun `an unauthorized or used approval token is refused without a rescrobble token`() = rescrobbleTest(lastFm = lastFm.engine) {
        val response = exchange("used-token")

        assertEquals(HttpStatusCode.Unauthorized, response.status)
        assertEquals("""{"error":"invalidToken"}""", response.bodyAsText())
    }

    @Test
    fun `Last fm being unavailable during the exchange is a retryable failure`() = rescrobbleTest(
        lastFm = LastFmFake { _, _ -> lastFmJson("<html>oops</html>", HttpStatusCode.BadGateway) }.engine,
    ) {
        val response = exchange("good-token")

        assertEquals(HttpStatusCode.ServiceUnavailable, response.status)
        assertEquals("""{"error":"lastFmUnavailable"}""", response.bodyAsText())
    }

    @Test
    fun `a request body without an approval token is a bad request`() = rescrobbleTest {
        val response = browser().post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("{}")
        }

        assertEquals(HttpStatusCode.BadRequest, response.status)
    }

    @Test
    fun `me works with the bearer token and matches the cookie response shape`() = rescrobbleTest(lastFm = lastFm.engine) {
        val token = signIn()

        val response = browser().get("/api/me") { header(HttpHeaders.Authorization, "Bearer $token") }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("""{"username":"rj","pro":false}""", response.bodyAsText())
    }

    @Test
    fun `the bearer scheme is case-insensitive`() = rescrobbleTest(lastFm = lastFm.engine) {
        val token = signIn()

        val response = browser().get("/api/me") { header(HttpHeaders.Authorization, "bearer $token") }

        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `malformed or undecryptable bearer headers are unauthorized`() = rescrobbleTest(lastFm = lastFm.engine) {
        val token = signIn()
        val malformed = listOf("Bearer", "Bearer ", "Basic $token", token, "Bearer not-a-real-token", "Bearer ${token.dropLast(3)}")

        for (header in malformed) {
            val response = browser().get("/api/me") { header(HttpHeaders.Authorization, header) }
            assertEquals(HttpStatusCode.Unauthorized, response.status, "Authorization: $header")
        }
    }

    @Test
    fun `an invalid bearer header is not rescued by a valid cookie`() = rescrobbleTest(lastFm = lastFm.engine) {
        val cookie = browser().get("/auth/callback?token=good-token").headers[HttpHeaders.SetCookie]!!
            .substringBefore(';')

        val response = browser().get("/api/me") {
            header(HttpHeaders.Cookie, cookie)
            header(HttpHeaders.Authorization, "Bearer not-a-real-token")
        }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `a token made with a different encryption key is unauthorized`() {
        var token = ""
        rescrobbleTest(lastFm = lastFm.engine) { token = signIn() }

        val rotated = Config.fromEnvironment(
            testEnvironment + ("SESSION_ENCRYPTION_KEY" to "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="),
        )
        rescrobbleTest(config = rotated) {
            val response = browser().get("/api/me") { header(HttpHeaders.Authorization, "Bearer $token") }

            assertEquals(HttpStatusCode.Unauthorized, response.status)
        }
    }
}
