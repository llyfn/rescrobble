package io.github.llyfn.rescrobble

import io.ktor.client.engine.mock.MockEngine
import io.ktor.client.engine.mock.MockRequestHandleScope
import io.ktor.client.engine.mock.respond
import io.ktor.client.request.HttpRequestData
import io.ktor.client.request.HttpResponseData
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import io.ktor.http.Parameters
import io.ktor.http.content.OutgoingContent
import io.ktor.http.headersOf
import io.ktor.http.decodeURLQueryComponent

/** A scripted Last.fm that records every request it receives. */
class LastFmFake(
    private val reply: MockRequestHandleScope.(method: String, form: Parameters) -> HttpResponseData,
) {
    val requests = mutableListOf<Pair<HttpRequestData, Parameters>>()

    val engine = MockEngine { request ->
        val form = formOf(request)
        requests += request to form
        reply(form["method"].orEmpty(), form)
    }

    /** Decodes the form body the way a form-encoding server does, with `+` meaning a space. */
    private fun formOf(request: HttpRequestData): Parameters {
        val body = request.body as? OutgoingContent.ByteArrayContent ?: return Parameters.Empty
        return Parameters.build {
            String(body.bytes(), Charsets.UTF_8).split('&').filter { it.isNotEmpty() }.forEach { pair ->
                val (name, value) = pair.split('=', limit = 2).let { it[0] to it.getOrElse(1) { "" } }
                append(name.decodeURLQueryComponent(plusIsSpace = true), value.decodeURLQueryComponent(plusIsSpace = true))
            }
        }
    }
}

fun MockRequestHandleScope.lastFmJson(json: String, status: HttpStatusCode = HttpStatusCode.OK) =
    respond(json, status, headersOf(HttpHeaders.ContentType, "application/json"))

fun MockRequestHandleScope.lastFmError(code: Int, message: String) =
    lastFmJson("""{"error":$code,"message":"$message"}""", HttpStatusCode.Forbidden)

fun sessionJson(username: String, sessionKey: String) =
    """{"session":{"name":"$username","key":"$sessionKey","subscriber":0}}"""

/** One Last.fm `scrobble` entry as Last.fm's JSON format renders it. */
fun scrobbleEntryJson(
    artist: String,
    track: String,
    timestamp: String,
    artistCorrected: Boolean = false,
    trackCorrected: Boolean = false,
    ignoredCode: Int = 0,
    ignoredMessage: String = "",
) = """{"artist":{"corrected":"${if (artistCorrected) 1 else 0}","#text":"$artist"},""" +
    """"track":{"corrected":"${if (trackCorrected) 1 else 0}","#text":"$track"},""" +
    """"album":{"corrected":"0","#text":""},"albumArtist":{"corrected":"0","#text":""},""" +
    """"timestamp":"$timestamp","ignoredMessage":{"code":"$ignoredCode","#text":"$ignoredMessage"}}"""

/** Wraps entries the way Last.fm does, including collapsing a single entry into a bare object. */
fun scrobblesJson(entries: List<String>): String {
    val ignored = entries.count { !it.contains(""""code":"0"""") }
    val scrobble = entries.singleOrNull() ?: entries.joinToString(",", "[", "]")
    return """{"scrobbles":{"scrobble":$scrobble,"@attr":{"accepted":${entries.size - ignored},"ignored":$ignored}}}"""
}

/** Echoes every submitted Scrobble back as accepted and uncorrected. */
fun acceptAll(form: Parameters): String {
    val count = form.names().count { it.startsWith("artist[") }
    return scrobblesJson(
        (0 until count).map { i -> scrobbleEntryJson(form["artist[$i]"]!!, form["track[$i]"]!!, form["timestamp[$i]"]!!) },
    )
}
