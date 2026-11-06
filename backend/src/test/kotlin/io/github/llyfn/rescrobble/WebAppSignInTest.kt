package io.github.llyfn.rescrobble

import io.ktor.client.request.cookie
import io.ktor.client.request.get
import io.ktor.client.request.post
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Url
import io.ktor.http.parseServerSetCookieHeader
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class WebAppSignInTest {
    private val signedInLastFm = LastFmFake { method, _ ->
        when (method) {
            "auth.getSession" -> lastFmJson(sessionJson("rj", "session-key-123"))
            else -> error("unexpected Last.fm method $method")
        }
    }

    private fun HttpResponse.sessionCookie() =
        headers.getAll(HttpHeaders.SetCookie).orEmpty()
            .map(::parseServerSetCookieHeader)
            .singleOrNull { it.name == SESSION_COOKIE }

    @Test
    fun `login redirects to the Last fm approval page with the api key and callback`() = rescrobbleTest {
        val response = browser().get("/auth/login")

        assertEquals(HttpStatusCode.Found, response.status)
        val location = Url(response.headers[HttpHeaders.Location]!!)
        assertEquals("www.last.fm", location.host)
        assertEquals("/api/auth/", location.encodedPath)
        assertEquals("test-api-key", location.parameters["api_key"])
        assertEquals("https://rescrobble.test/auth/callback", location.parameters["cb"])
    }

    @Test
    fun `a valid token signs the user in and redirects into the Web App`() = rescrobbleTest(lastFm = signedInLastFm.engine) {
        val response = browser().get("/auth/callback?token=test-token")

        assertEquals(HttpStatusCode.Found, response.status)
        assertEquals("/", response.headers[HttpHeaders.Location])
        assertNotNull(response.sessionCookie())
    }

    @Test
    fun `the token exchange is a correctly signed auth getSession call`() = rescrobbleTest(lastFm = signedInLastFm.engine) {
        browser().get("/auth/callback?token=test-token")

        val (request, form) = signedInLastFm.requests.single()
        assertEquals("POST", request.method.value)
        assertEquals("https://ws.audioscrobbler.com/2.0/", request.url.toString())
        assertEquals("auth.getSession", form["method"])
        assertEquals("test-api-key", form["api_key"])
        assertEquals("test-token", form["token"])
        assertEquals("json", form["format"])
        // md5("api_keytest-api-keymethodauth.getSessiontokentest-token" + "test-shared-secret")
        assertEquals("66979c65d39e148d1bfd0e1dac411a05", form["api_sig"])
    }

    @Test
    fun `the session cookie is not readable as plain text`() = rescrobbleTest(
        lastFm = LastFmFake { _, _ -> lastFmJson(sessionJson("distinctive-username", "distinctive-session-key")) }.engine,
    ) {
        val cookie = browser().get("/auth/callback?token=test-token").sessionCookie()!!

        assertTrue("distinctive-session-key" !in cookie.value)
        assertTrue("distinctive-username" !in cookie.value)
    }

    @Test
    fun `an invalid token sets no cookie and reports the failure to the Web App`() = rescrobbleTest(
        lastFm = LastFmFake { _, _ -> lastFmError(4, "Invalid authentication token supplied") }.engine,
    ) {
        val response = browser().get("/auth/callback?token=bad-token")

        assertEquals(HttpStatusCode.Found, response.status)
        assertEquals(SIGN_IN_FAILED_PATH, response.headers[HttpHeaders.Location])
        assertNull(response.sessionCookie())
    }

    @Test
    fun `a callback without a token reports the failure without calling Last fm`() = rescrobbleTest {
        val response = browser().get("/auth/callback")

        assertEquals(SIGN_IN_FAILED_PATH, response.headers[HttpHeaders.Location])
        assertNull(response.sessionCookie())
    }

    @Test
    fun `Last fm being unreachable during sign-in reports the failure`() = rescrobbleTest(
        lastFm = LastFmFake { _, _ -> lastFmJson("<html>bad gateway</html>", HttpStatusCode.BadGateway) }.engine,
    ) {
        val response = browser().get("/auth/callback?token=test-token")

        assertEquals(SIGN_IN_FAILED_PATH, response.headers[HttpHeaders.Location])
        assertNull(response.sessionCookie())
    }

    @Test
    fun `me returns the signed-in username with Pro unknown`() = rescrobbleTest(lastFm = signedInLastFm.engine) {
        val client = browser()
        val cookie = client.get("/auth/callback?token=test-token").sessionCookie()!!

        val response = client.get("/api/me") { cookie(cookie.name, cookie.value) }

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("""{"username":"rj","pro":null}""", response.bodyAsText())
    }

    @Test
    fun `me without a session is unauthorized`() = rescrobbleTest {
        assertEquals(HttpStatusCode.Unauthorized, browser().get("/api/me").status)
    }

    @Test
    fun `a tampered cookie counts as signed out`() = rescrobbleTest(lastFm = signedInLastFm.engine) {
        val client = browser()
        val cookie = client.get("/auth/callback?token=test-token").sessionCookie()!!
        val tampered = cookie.value.dropLast(2) + if (cookie.value.endsWith("AA")) "BB" else "AA"

        val response = client.get("/api/me") { cookie(cookie.name, tampered) }

        assertEquals(HttpStatusCode.Unauthorized, response.status)
    }

    @Test
    fun `a cookie made with a different encryption key counts as signed out`() {
        var issuedCookie = ""
        rescrobbleTest(lastFm = signedInLastFm.engine) {
            issuedCookie = browser().get("/auth/callback?token=test-token").sessionCookie()!!.value
        }

        val rotated = Config.fromEnvironment(
            testEnvironment + ("SESSION_ENCRYPTION_KEY" to "ICEiIyQlJicoKSorLC0uLzAxMjM0NTY3ODk6Ozw9Pj8="),
        )
        rescrobbleTest(config = rotated) {
            val response = browser().get("/api/me") { cookie(SESSION_COOKIE, issuedCookie) }

            assertEquals(HttpStatusCode.Unauthorized, response.status)
        }
    }

    @Test
    fun `logout clears the session cookie`() = rescrobbleTest(lastFm = signedInLastFm.engine) {
        val client = browser()
        val cookie = client.get("/auth/callback?token=test-token").sessionCookie()!!

        val response = client.post("/auth/logout") { cookie(cookie.name, cookie.value) }

        assertEquals(HttpStatusCode.NoContent, response.status)
        val cleared = response.sessionCookie()!!
        assertEquals("", cleared.value)
        assertEquals(0, cleared.maxAge)
    }
}
