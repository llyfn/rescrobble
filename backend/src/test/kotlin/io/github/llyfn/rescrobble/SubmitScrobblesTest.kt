package io.github.llyfn.rescrobble

import io.ktor.client.request.HttpRequestBuilder
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
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.time.Duration
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SubmitScrobblesTest {
    private val clock = TestClock()
    private val now = clock.now.epochSecond
    private val hourAgo = now - 3600

    private fun lastFm(scrobble: (Parameters) -> String = ::acceptAll) = LastFmFake { method, form ->
        when (method) {
            "auth.getSession" -> lastFmJson(sessionJson("rj", "session-key-123"))
            "track.scrobble" -> lastFmJson(scrobble(form))
            else -> error("unexpected Last.fm method $method")
        }
    }

    private fun LastFmFake.scrobbleForms() = requests.map { it.second }.filter { it["method"] == "track.scrobble" }

    private suspend fun ApplicationTestBuilder.bearerAuth(): HttpRequestBuilder.() -> Unit {
        val body = browser().post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"approval"}""")
        }.bodyAsText()
        val token = Json.parseToJsonElement(body).jsonObject.getValue("token").jsonPrimitive.content
        return { header(HttpHeaders.Authorization, "Bearer $token") }
    }

    private suspend fun ApplicationTestBuilder.cookieAuth(): HttpRequestBuilder.() -> Unit {
        val cookie = browser().get("/auth/callback?token=approval").headers[HttpHeaders.SetCookie]!!.substringBefore(';')
        return { header(HttpHeaders.Cookie, cookie) }
    }

    private suspend fun ApplicationTestBuilder.submit(json: String, auth: HttpRequestBuilder.() -> Unit = {}): HttpResponse =
        browser().post("/api/scrobbles") {
            auth()
            contentType(ContentType.Application.Json)
            setBody(json)
        }

    private suspend fun HttpResponse.results(): List<JsonObject> =
        Json.parseToJsonElement(bodyAsText()).jsonObject.getValue("results").jsonArray.map { it.jsonObject }

    private fun JsonObject.str(name: String) = getValue(name).jsonPrimitive.content

    private fun entry(artist: String = "Cher", track: String = "Believe", timestamp: Long = hourAgo, extra: String = "") =
        """{"artist":"$artist","track":"$track","timestamp":$timestamp$extra}"""

    private fun batch(entries: List<String>) = entries.joinToString(",", """{"scrobbles":[""", "]}")
    private fun batch(vararg entries: String) = batch(entries.toList())

    @Test
    fun `a single Scrobble is submitted and reported accepted`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val response = submit(batch(entry()), bearerAuth())

            assertEquals(HttpStatusCode.OK, response.status)
            assertEquals(
                """{"results":[{"status":"accepted","artist":"Cher","artistCorrected":false,"track":"Believe","trackCorrected":false}]}""",
                response.bodyAsText(),
            )
            val form = lastFm.scrobbleForms().single()
            assertEquals("session-key-123", form["sk"])
            assertEquals("Cher", form["artist[0]"])
            assertEquals("Believe", form["track[0]"])
            assertEquals(hourAgo.toString(), form["timestamp[0]"])
        }
    }

    @Test
    fun `the cookie and the bearer token submit the same way`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val viaCookie = submit(batch(entry()), cookieAuth())
            val viaBearer = submit(batch(entry()), bearerAuth())

            assertEquals(HttpStatusCode.OK, viaCookie.status)
            assertEquals(viaCookie.bodyAsText(), viaBearer.bodyAsText())
            assertEquals(listOf("session-key-123", "session-key-123"), lastFm.scrobbleForms().map { it["sk"] })
        }
    }

    @Test
    fun `submitting without signing in is unauthorized and reaches nothing`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            assertEquals(HttpStatusCode.Unauthorized, submit(batch(entry())).status)
            assertTrue(lastFm.requests.isEmpty())
        }
    }

    @Test
    fun `an empty batch or one over 50 is refused whole`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val auth = bearerAuth()

            val empty = submit(batch(), auth)
            val tooMany = submit(batch(List(51) { entry(track = "Track $it") }), auth)

            assertEquals(HttpStatusCode.BadRequest, empty.status)
            assertEquals(HttpStatusCode.BadRequest, tooMany.status)
            assertEquals("""{"error":"batchSize"}""", tooMany.bodyAsText())
            assertTrue(lastFm.scrobbleForms().isEmpty())
        }
    }

    @Test
    fun `a batch of exactly 50 goes to Last fm as one request`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val response = submit(batch(List(50) { entry(track = "Track $it", timestamp = hourAgo + it) }), bearerAuth())

            assertEquals(50, response.results().count { it.str("status") == "accepted" })
            val form = lastFm.scrobbleForms().single()
            assertEquals("Track 49", form["track[49]"])
        }
    }

    @Test
    fun `entries missing a required field are rejected with that field`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val response = submit(
                batch(
                    """{"track":"Believe","timestamp":$hourAgo}""",
                    """{"artist":"Cher","track":"  ","timestamp":$hourAgo}""",
                    """{"artist":"Cher","track":"Believe"}""",
                ),
                bearerAuth(),
            )

            val results = response.results()
            assertEquals(listOf("artist", "track", "timestamp"), results.map { it.str("field") })
            assertTrue(results.all { it.str("status") == "rejected" && it.str("reason") == "missingField" })
            assertTrue(lastFm.scrobbleForms().isEmpty())
        }
    }

    @Test
    fun `timestamps outside the window are rejected before reaching Last fm`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val window = Duration.ofDays(14).seconds
            val response = submit(
                batch(
                    entry(timestamp = now - window),
                    entry(timestamp = now - window - 1),
                    entry(timestamp = now),
                    entry(timestamp = now + 1),
                ),
                bearerAuth(),
            )

            assertEquals(
                listOf("accepted", "tooOld", "accepted", "inFuture"),
                response.results().map { if (it.str("status") == "rejected") it.str("reason") else it.str("status") },
            )
            val form = lastFm.scrobbleForms().single()
            assertEquals(listOf((now - window).toString(), now.toString()), listOf(form["timestamp[0]"], form["timestamp[1]"]))
            assertEquals(null, form["timestamp[2]"])
        }
    }

    @Test
    fun `the window moves with the clock`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val auth = bearerAuth()
            val first = submit(batch(entry(timestamp = hourAgo)), auth).results().single()

            clock.advance(Duration.ofDays(14))
            val later = submit(batch(entry(timestamp = hourAgo)), auth).results().single()

            assertEquals("accepted", first.str("status"))
            assertEquals("tooOld", later.str("reason"))
        }
    }

    @Test
    fun `valid entries are still submitted when others in the batch are rejected, and results keep request order`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val response = submit(
                batch(
                    entry(track = "One"),
                    entry(track = "Too old", timestamp = 0),
                    entry(track = "Two"),
                    """{"artist":"","track":"No artist","timestamp":$hourAgo}""",
                    entry(track = "Three"),
                ),
                bearerAuth(),
            )

            val results = response.results()
            assertEquals(listOf("accepted", "rejected", "accepted", "rejected", "accepted"), results.map { it.str("status") })
            assertEquals(listOf("One", "Two", "Three"), results.filter { it.str("status") == "accepted" }.map { it.str("track") })
            val form = lastFm.scrobbleForms().single()
            assertEquals(listOf("One", "Two", "Three"), (0..2).map { form["track[$it]"] })
        }
    }

    @Test
    fun `optional album and album artist are sent only when present`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            submit(
                batch(
                    entry(extra = ""","album":"Believe","albumArtist":"Cher""""),
                    entry(extra = ""","album":"","albumArtist":null"""),
                ),
                bearerAuth(),
            )

            val form = lastFm.scrobbleForms().single()
            assertEquals("Believe", form["album[0]"])
            assertEquals("Cher", form["albumArtist[0]"])
            assertFalse("album[1]" in form.names())
            assertFalse("albumArtist[1]" in form.names())
        }
    }

    @Test
    fun `the batch signature sorts indexed parameters in ASCII order`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            submit(batch(List(11) { entry(artist = "Artist $it", track = "Track $it", timestamp = hourAgo + it * 60) }), bearerAuth())

            // md5 of the parameters sorted so that artist[10] precedes artist[1], plus the shared secret,
            // computed independently of the application code.
            assertEquals("c60ca5971e3bd2f1bde20f3fcfa27c1e", lastFm.scrobbleForms().single()["api_sig"])
        }
    }

    @Test
    fun `accepted results report Last fm's corrections`() {
        val lastFm = lastFm { form ->
            scrobblesJson(listOf(scrobbleEntryJson("Cher", "Believe", form["timestamp[0]"]!!, artistCorrected = true)))
        }
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val result = submit(batch(entry(artist = "cher")), bearerAuth()).results().single()

            assertEquals("Cher", result.str("artist"))
            assertEquals("true", result.str("artistCorrected"))
            assertEquals("false", result.str("trackCorrected"))
        }
    }

    @Test
    fun `each Last fm ignored code is reported as ignored with its message`() {
        val messages = mapOf(
            1 to "Artist was ignored",
            2 to "Track was ignored",
            3 to "Timestamp was too old",
            4 to "Timestamp was too new",
            5 to "Daily scrobble limit exceeded",
        )
        val lastFm = lastFm { form ->
            scrobblesJson(
                messages.keys.mapIndexed { i, code ->
                    scrobbleEntryJson(form["artist[$i]"]!!, form["track[$i]"]!!, form["timestamp[$i]"]!!, ignoredCode = code, ignoredMessage = messages.getValue(code))
                },
            )
        }
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val response = submit(batch(messages.keys.map { entry(track = "Track $it") }), bearerAuth())

            val results = response.results()
            assertTrue(results.all { it.str("status") == "ignored" })
            assertEquals(messages.keys.toList(), results.map { it.str("code").toInt() })
            assertEquals(messages.values.toList(), results.map { it.str("message") })
        }
    }

    @Test
    fun `non-Latin names reach Last fm exactly as sent`() {
        val lastFm = lastFm()
        rescrobbleTest(lastFm = lastFm.engine, clock = clock) {
            val response = submit(
                batch(
                    entry(artist = "아이유", track = "밤편지", extra = ""","album":"팔레트""""),
                    entry(artist = "宇多田ヒカル", track = "First Love"),
                    entry(artist = "Sigur Rós", track = "Hoppípolla", extra = ""","albumArtist":"Björk""""),
                ),
                bearerAuth(),
            )

            val form = lastFm.scrobbleForms().single()
            assertEquals(listOf("아이유", "宇多田ヒカル", "Sigur Rós"), (0..2).map { form["artist[$it]"] })
            assertEquals("밤편지", form["track[0]"])
            assertEquals("팔레트", form["album[0]"])
            assertEquals("Hoppípolla", form["track[2]"])
            assertEquals("Björk", form["albumArtist[2]"])
            assertEquals("밤편지", response.results()[0].str("track"))
        }
    }
}
