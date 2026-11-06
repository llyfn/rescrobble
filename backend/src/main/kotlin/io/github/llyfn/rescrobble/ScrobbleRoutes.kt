package io.github.llyfn.rescrobble

import io.ktor.http.HttpStatusCode
import io.ktor.server.request.receive
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.post
import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import java.time.Clock
import java.time.Instant

/** Fields are nullable so a missing one is reported per entry instead of failing the whole request. */
@Serializable
class ScrobbleEntry(
    val artist: String? = null,
    val track: String? = null,
    val timestamp: Long? = null,
    val album: String? = null,
    val albumArtist: String? = null,
)

@Serializable
class ScrobbleRequest(val scrobbles: List<ScrobbleEntry>)

@Serializable
sealed interface ScrobbleResult {
    @Serializable
    @SerialName("accepted")
    class Accepted(
        val artist: String,
        val artistCorrected: Boolean,
        val track: String,
        val trackCorrected: Boolean,
    ) : ScrobbleResult

    @Serializable
    @SerialName("ignored")
    class Ignored(val code: Int, val message: String) : ScrobbleResult

    @Serializable
    @SerialName("rejected")
    class Rejected(val reason: String, val field: String? = null) : ScrobbleResult
}

@Serializable
class ScrobbleResponse(val results: List<ScrobbleResult>)

fun Route.scrobbleRoutes(lastFm: LastFmClient, tokens: SessionTokenCodec, clock: Clock) {
    post("/api/scrobbles") {
        val user = call.signedInUser(tokens) ?: return@post call.respond(HttpStatusCode.Unauthorized)
        val entries = call.receive<ScrobbleRequest>().scrobbles
        if (entries.size !in 1..LastFmClient.MAX_BATCH) {
            return@post call.respond(HttpStatusCode.BadRequest, ErrorResponse("batchSize"))
        }

        val now = clock.instant()
        val checked = entries.map { validate(it, now) }
        val submissions = checked.filterIsInstance<Validated.Valid>().map { it.submission }
        val outcomes = try {
            if (submissions.isEmpty()) emptyList() else lastFm.scrobble(user.sessionKey, submissions)
        } catch (e: LastFmException) {
            return@post call.respondLastFmFailure(e)
        }

        val outcomeIterator = outcomes.iterator()
        val results = checked.map { check ->
            when (check) {
                is Validated.Invalid -> check.result
                is Validated.Valid -> when (val outcome = outcomeIterator.next()) {
                    is ScrobbleOutcome.Accepted -> ScrobbleResult.Accepted(
                        outcome.artist, outcome.artistCorrected, outcome.track, outcome.trackCorrected,
                    )
                    is ScrobbleOutcome.Ignored -> ScrobbleResult.Ignored(outcome.code, outcome.message)
                }
            }
        }
        call.respond(ScrobbleResponse(results))
    }
}

private sealed interface Validated {
    class Valid(val submission: ScrobbleSubmission) : Validated
    class Invalid(val result: ScrobbleResult.Rejected) : Validated
}

private fun validate(entry: ScrobbleEntry, now: Instant): Validated {
    val artist = entry.artist?.takeIf { it.isNotBlank() }
        ?: return Validated.Invalid(ScrobbleResult.Rejected("missingField", "artist"))
    val track = entry.track?.takeIf { it.isNotBlank() }
        ?: return Validated.Invalid(ScrobbleResult.Rejected("missingField", "track"))
    val timestamp = entry.timestamp
        ?: return Validated.Invalid(ScrobbleResult.Rejected("missingField", "timestamp"))

    return when (checkTimestamp(timestamp, now)) {
        TimestampCheck.TOO_OLD -> Validated.Invalid(ScrobbleResult.Rejected("tooOld"))
        TimestampCheck.IN_FUTURE -> Validated.Invalid(ScrobbleResult.Rejected("inFuture"))
        TimestampCheck.ACCEPTABLE -> Validated.Valid(
            ScrobbleSubmission(
                artist = artist,
                track = track,
                timestamp = timestamp,
                album = entry.album?.takeIf { it.isNotBlank() },
                albumArtist = entry.albumArtist?.takeIf { it.isNotBlank() },
            ),
        )
    }
}
