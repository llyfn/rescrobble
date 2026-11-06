package io.github.llyfn.rescrobble

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
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class RateLimitTest {
    private val clock = TestClock()
    private val limits = RateLimits()
    private var lastFmDown = false

    /** Each approval token signs in a different account, with session key `sk-<token>`. */
    private val lastFm = LastFmFake { method, form ->
        when {
            method == "auth.getSession" -> lastFmJson(sessionJson("user-${form["token"]}", "sk-${form["token"]}"))
            method == "track.scrobble" && lastFmDown -> lastFmError(16, "There was a temporary error processing your request")
            method == "track.scrobble" -> lastFmJson(acceptAll(form))
            else -> error("unexpected Last.fm method $method")
        }
    }

    private fun scrobblesSent() = lastFm.requests.map { it.second }.filter { it["method"] == "track.scrobble" }
        .sumOf { form -> form.names().count { it.startsWith("artist[") } }

    private suspend fun ApplicationTestBuilder.signIn(account: String): String {
        val body = browser().post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"$account"}""")
        }.bodyAsText()
        return "Bearer " + Json.parseToJsonElement(body).jsonObject.getValue("token").jsonPrimitive.content
    }

    private suspend fun ApplicationTestBuilder.submit(auth: String, count: Int, valid: Boolean = true): HttpResponse {
        val timestamp = if (valid) clock.now.epochSecond - 60 else 0
        val entries = List(count) { """{"artist":"Artist","track":"Track $it","timestamp":$timestamp}""" }
        return browser().post("/api/scrobbles") {
            header(HttpHeaders.Authorization, auth)
            contentType(ContentType.Application.Json)
            setBody(entries.joinToString(",", """{"scrobbles":[""", "]}"))
        }
    }

    /** Uses up [scrobbles] of the account's daily allowance, pacing requests to stay under the burst limit. */
    private suspend fun ApplicationTestBuilder.useUp(auth: String, scrobbles: Int) {
        var left = scrobbles
        while (left > 0) {
            val batch = minOf(left, LastFmClient.MAX_BATCH)
            assertEquals(HttpStatusCode.OK, submit(auth, batch).status)
            clock.advance(Duration.ofSeconds(2))
            left -= batch
        }
    }

    @Test
    fun `the whole daily allowance can be used, and the next Scrobble is refused`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = signIn("a")
        useUp(auth, limits.dailyScrobbles)

        val response = submit(auth, 1)

        assertEquals(HttpStatusCode.TooManyRequests, response.status)
        assertEquals("""{"error":"dailyLimit"}""", response.bodyAsText())
        assertTrue(response.headers[HttpHeaders.RetryAfter]!!.toLong() > 0)
        assertEquals(limits.dailyScrobbles, scrobblesSent())
    }

    @Test
    fun `a batch that would cross the allowance is refused whole, while a smaller one still fits`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = signIn("a")
        useUp(auth, limits.dailyScrobbles - 10)

        assertEquals(HttpStatusCode.TooManyRequests, submit(auth, 11).status)
        assertEquals(HttpStatusCode.OK, submit(auth, 10).status)
        assertEquals(limits.dailyScrobbles, scrobblesSent())
    }

    @Test
    fun `rejected entries don't count against the allowance`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = signIn("a")
        useUp(auth, limits.dailyScrobbles)

        val response = submit(auth, 5, valid = false)

        assertEquals(HttpStatusCode.OK, response.status)
        assertTrue(response.bodyAsText().contains("tooOld"))
    }

    @Test
    fun `the allowance frees up as the 24-hour window rolls past`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = signIn("a")
        useUp(auth, limits.dailyScrobbles)
        val retryAfter = Duration.ofSeconds(submit(auth, 50).headers[HttpHeaders.RetryAfter]!!.toLong())

        clock.advance(retryAfter)

        assertEquals(HttpStatusCode.OK, submit(auth, 50).status)
    }

    @Test
    fun `Scrobbles that fail at Last fm are returned to the allowance`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = signIn("a")
        useUp(auth, limits.dailyScrobbles - 50)

        lastFmDown = true
        assertEquals(HttpStatusCode.ServiceUnavailable, submit(auth, 50).status)
        lastFmDown = false
        clock.advance(Duration.ofSeconds(2))

        assertEquals(HttpStatusCode.OK, submit(auth, 50).status)
    }

    @Test
    fun `a burst of requests beyond the burst limit is refused until the window passes`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val auth = signIn("a")
        repeat(limits.burstRequests) { assertEquals(HttpStatusCode.OK, submit(auth, 1).status) }

        val refused = submit(auth, 1)

        assertEquals(HttpStatusCode.TooManyRequests, refused.status)
        assertEquals("""{"error":"tooManyRequests"}""", refused.bodyAsText())
        assertEquals(limits.burstWindow.seconds.toString(), refused.headers[HttpHeaders.RetryAfter])
        assertEquals(limits.burstRequests, scrobblesSent())

        clock.advance(limits.burstWindow)
        assertEquals(HttpStatusCode.OK, submit(auth, 1).status)
    }

    @Test
    fun `one account reaching its limits doesn't affect another`() = rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
        val first = signIn("a")
        val second = signIn("b")
        useUp(first, limits.dailyScrobbles)
        repeat(limits.burstRequests) { submit(first, 1, valid = false) }

        assertEquals(HttpStatusCode.TooManyRequests, submit(first, 1).status)
        assertEquals(HttpStatusCode.OK, submit(second, 50).status)
    }
}
