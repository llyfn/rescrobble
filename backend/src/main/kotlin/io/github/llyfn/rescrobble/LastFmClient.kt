package io.github.llyfn.rescrobble

import io.ktor.client.HttpClient
import io.ktor.client.engine.HttpClientEngine
import io.ktor.client.request.forms.submitForm
import io.ktor.client.statement.bodyAsText
import io.ktor.http.parameters
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import java.security.MessageDigest

class LastFmSession(val username: String, val sessionKey: String)

class ScrobbleSubmission(
    val artist: String,
    val track: String,
    val timestamp: Long,
    val album: String? = null,
    val albumArtist: String? = null,
)

sealed interface ScrobbleOutcome {
    class Accepted(
        val artist: String,
        val artistCorrected: Boolean,
        val track: String,
        val trackCorrected: Boolean,
    ) : ScrobbleOutcome

    class Ignored(val code: Int, val message: String) : ScrobbleOutcome
}

sealed class LastFmException(message: String, cause: Throwable? = null) : Exception(message, cause) {
    /** Last.fm answered with an API error code. */
    class Api(val code: Int, message: String) : LastFmException("Last.fm error $code: $message")

    /** Last.fm could not be reached or answered with something other than an API response. */
    class Unavailable(message: String, cause: Throwable? = null) : LastFmException(message, cause)
}

class LastFmClient(
    engine: HttpClientEngine,
    private val apiKey: String,
    private val sharedSecret: String,
) : AutoCloseable {
    private val http = HttpClient(engine) { expectSuccess = false }

    suspend fun getSession(token: String): LastFmSession {
        val body = signedCall("auth.getSession", mapOf("token" to token))
        val session = body["session"]?.jsonObject
            ?: throw LastFmException.Unavailable("auth.getSession response has no session")
        return LastFmSession(
            username = session.getValue("name").jsonPrimitive.content,
            sessionKey = session.getValue("key").jsonPrimitive.content,
        )
    }

    /** Signed with the session key and no `user`, so Last.fm answers for, and validates, that session. */
    suspend fun getAuthenticatedUsername(sessionKey: String): String {
        val user = signedCall("user.getInfo", mapOf("sk" to sessionKey))["user"]?.jsonObject
            ?: throw LastFmException.Unavailable("user.getInfo response has no user")
        return user.getValue("name").jsonPrimitive.content
    }

    /** Submits up to 50 Scrobbles in one batch; outcomes come back in submission order. */
    suspend fun scrobble(sessionKey: String, submissions: List<ScrobbleSubmission>): List<ScrobbleOutcome> {
        require(submissions.size in 1..MAX_BATCH) { "a batch holds 1 to $MAX_BATCH Scrobbles" }
        val params = buildMap {
            put("sk", sessionKey)
            submissions.forEachIndexed { i, s ->
                put("artist[$i]", s.artist)
                put("track[$i]", s.track)
                put("timestamp[$i]", s.timestamp.toString())
                s.album?.let { put("album[$i]", it) }
                s.albumArtist?.let { put("albumArtist[$i]", it) }
            }
        }
        val scrobbles = signedCall("track.scrobble", params)["scrobbles"]?.jsonObject
            ?: throw LastFmException.Unavailable("track.scrobble response has no scrobbles")
        // Last.fm's JSON collapses a one-element list into a bare object.
        val entries = when (val scrobble = scrobbles["scrobble"]) {
            is JsonArray -> scrobble.map { it.jsonObject }
            is JsonObject -> listOf(scrobble)
            else -> emptyList()
        }
        if (entries.size != submissions.size) {
            throw LastFmException.Unavailable("track.scrobble returned ${entries.size} results for ${submissions.size} Scrobbles")
        }
        return entries.map(::outcomeOf)
    }

    private fun outcomeOf(entry: JsonObject): ScrobbleOutcome {
        val ignored = entry["ignoredMessage"]?.jsonObject
        val ignoredCode = ignored?.get("code")?.jsonPrimitive?.content?.toIntOrNull() ?: 0
        if (ignoredCode != 0) {
            return ScrobbleOutcome.Ignored(ignoredCode, ignored?.get("#text")?.jsonPrimitive?.content.orEmpty())
        }
        return ScrobbleOutcome.Accepted(
            artist = entry.text("artist"),
            artistCorrected = entry.corrected("artist"),
            track = entry.text("track"),
            trackCorrected = entry.corrected("track"),
        )
    }

    private fun JsonObject.field(name: String) = get(name) as? JsonObject
    private fun JsonObject.text(name: String) = field(name)?.get("#text")?.jsonPrimitive?.content.orEmpty()
    private fun JsonObject.corrected(name: String) = field(name)?.get("corrected")?.jsonPrimitive?.content == "1"

    private suspend fun signedCall(method: String, params: Map<String, String>): JsonObject {
        val signed = params + mapOf("method" to method, "api_key" to apiKey)
        val form = signed + mapOf("api_sig" to signature(signed, sharedSecret), "format" to "json")

        val text = try {
            http.submitForm(API_URL, parameters { form.forEach { (k, v) -> append(k, v) } }).bodyAsText()
        } catch (e: Exception) {
            throw LastFmException.Unavailable("Last.fm request failed", e)
        }
        val json = runCatching { Json.parseToJsonElement(text).jsonObject }.getOrNull()
            ?: throw LastFmException.Unavailable("Last.fm returned a non-JSON response")

        json["error"]?.let { error ->
            throw LastFmException.Api(error.jsonPrimitive.int, json["message"]?.jsonPrimitive?.content.orEmpty())
        }
        return json
    }

    override fun close() = http.close()

    companion object {
        const val API_URL = "https://ws.audioscrobbler.com/2.0/"
        const val AUTH_URL = "https://www.last.fm/api/auth/"
        const val MAX_BATCH = 50
        const val INVALID_SESSION = 9

        /**
         * Last.fm signs every parameter except `format` and `callback`, sorted by name in ASCII order,
         * so `artist[10]` comes before `artist[1]`.
         */
        fun signature(params: Map<String, String>, sharedSecret: String): String {
            val payload = params
                .filterKeys { it != "format" && it != "callback" }
                .toSortedMap()
                .entries.joinToString("") { (k, v) -> k + v } + sharedSecret
            return MessageDigest.getInstance("MD5")
                .digest(payload.toByteArray(Charsets.UTF_8))
                .joinToString("") { "%02x".format(it) }
        }
    }
}
