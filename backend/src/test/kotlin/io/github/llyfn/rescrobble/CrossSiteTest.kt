package io.github.llyfn.rescrobble

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.options
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import io.ktor.http.parseServerSetCookieHeader
import io.ktor.server.testing.ApplicationTestBuilder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CrossSiteTest {
    private val clock = TestClock()
    private val webApp = "https://rescrobble.test"
    private val extension = "chrome-extension://testextensionid"
    private val elsewhere = "https://evil.example"

    private val lastFm = LastFmFake { method, form ->
        when (method) {
            "auth.getSession" -> lastFmJson(sessionJson("rj", "session-key-123"))
            "track.scrobble" -> lastFmJson(acceptAll(form))
            else -> error("unexpected Last.fm method $method")
        }
    }

    private fun scrobbleCalls() = lastFm.requests.count { it.second["method"] == "track.scrobble" }

    private val oneScrobble = """{"scrobbles":[{"artist":"Cher","track":"Believe","timestamp":${clock.now.epochSecond - 60}}]}"""

    private suspend fun ApplicationTestBuilder.sessionCookie(): String =
        browser().get("/auth/callback?token=approval").headers[HttpHeaders.SetCookie]!!.substringBefore(';')

    private suspend fun ApplicationTestBuilder.bearer(): String {
        val body = browser(extension).post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"approval"}""")
        }.bodyAsText()
        return "Bearer " + Json.parseToJsonElement(body).jsonObject.getValue("token").jsonPrimitive.content
    }

    private suspend fun ApplicationTestBuilder.scrobbleWithCookie(origin: String?): HttpResponse {
        val cookie = sessionCookie()
        return browser(origin).post("/api/scrobbles") {
            header(HttpHeaders.Cookie, cookie)
            contentType(ContentType.Application.Json)
            setBody(oneScrobble)
        }
    }

    private suspend fun ApplicationTestBuilder.preflight(origin: String): HttpResponse =
        browser(origin).options("/api/scrobbles") {
            header(HttpHeaders.AccessControlRequestMethod, "POST")
            header(HttpHeaders.AccessControlRequestHeaders, "authorization, content-type")
        }

    @Test
    fun `a cookie submission from the Web App's own origin goes through`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        assertEquals(HttpStatusCode.OK, scrobbleWithCookie(webApp).status)
        assertEquals(1, scrobbleCalls())
    }

    @Test
    fun `a cookie submission triggered by another site is refused`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        assertEquals(HttpStatusCode.Forbidden, scrobbleWithCookie(elsewhere).status)
        assertEquals(0, scrobbleCalls())
    }

    @Test
    fun `a cookie submission without an Origin is refused`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        assertEquals(HttpStatusCode.Forbidden, scrobbleWithCookie(origin = null).status)
        assertEquals(0, scrobbleCalls())
    }

    @Test
    fun `logout triggered by another site or without an Origin is refused and keeps the session`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val cookie = sessionCookie()

        for (origin in listOf(elsewhere, null)) {
            val response = browser(origin).post("/auth/logout") { header(HttpHeaders.Cookie, cookie) }

            assertEquals(HttpStatusCode.Forbidden, response.status, "Origin: $origin")
            assertNull(response.headers[HttpHeaders.SetCookie])
        }
    }

    @Test
    fun `the Extension's bearer submission is accepted from its origin with CORS approval`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = bearer()

        val response = browser(extension).post("/api/scrobbles") {
            header(HttpHeaders.Authorization, auth)
            contentType(ContentType.Application.Json)
            setBody(oneScrobble)
        }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(extension, response.headers[HttpHeaders.AccessControlAllowOrigin])
        assertNull(response.headers[HttpHeaders.AccessControlAllowCredentials])
    }

    @Test
    fun `a bearer submission from a non-browser client without an Origin is accepted`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = bearer()

        val response = browser(origin = null).post("/api/scrobbles") {
            header(HttpHeaders.Authorization, auth)
            contentType(ContentType.Application.Json)
            setBody(oneScrobble)
        }

        assertEquals(HttpStatusCode.OK, response.status)
    }

    @Test
    fun `preflights from the Web App and the Extension are approved`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        for (origin in listOf(webApp, extension)) {
            val response = preflight(origin)

            assertEquals(HttpStatusCode.OK, response.status, origin)
            assertEquals(origin, response.headers[HttpHeaders.AccessControlAllowOrigin])
            val allowedHeaders = response.headers[HttpHeaders.AccessControlAllowHeaders]!!.lowercase()
            assertTrue("authorization" in allowedHeaders && "content-type" in allowedHeaders, allowedHeaders)
            assertTrue("POST" in response.headers[HttpHeaders.AccessControlAllowMethods].orEmpty())
        }
    }

    @Test
    fun `preflights and requests from any other origin get no CORS approval`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val otherOrigins = listOf(elsewhere, "chrome-extension://someotherextension", "http://rescrobble.test")

        for (origin in otherOrigins) {
            assertNull(preflight(origin).headers[HttpHeaders.AccessControlAllowOrigin], origin)
            assertNull(browser(origin).get("/api/me").headers[HttpHeaders.AccessControlAllowOrigin], origin)
        }
    }

    @Test
    fun `the session cookie is HttpOnly, Secure, SameSite Lax and site-wide on sign-in and logout`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val client = browser()
        val issued = client.get("/auth/callback?token=approval").headers[HttpHeaders.SetCookie]!!
        val cleared = client.post("/auth/logout") { header(HttpHeaders.Cookie, issued.substringBefore(';')) }
            .headers[HttpHeaders.SetCookie]!!

        for (header in listOf(issued, cleared)) {
            val cookie = parseServerSetCookieHeader(header)
            assertTrue(cookie.httpOnly, header)
            assertTrue(cookie.secure, header)
            assertEquals("/", cookie.path, header)
            assertEquals("Lax", cookie.extensions["SameSite"], header)
        }
    }
}
