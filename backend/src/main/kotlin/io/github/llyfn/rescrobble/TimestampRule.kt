package io.github.llyfn.rescrobble

import java.time.Duration
import java.time.Instant

enum class TimestampCheck { ACCEPTABLE, TOO_OLD, IN_FUTURE }

/** Last.fm silently ignores older Scrobbles. Observed behaviour, not documented. */
val SCROBBLE_WINDOW: Duration = Duration.ofDays(14)

fun checkTimestamp(timestamp: Long, now: Instant): TimestampCheck {
    val nowSeconds = now.epochSecond
    return when {
        timestamp > nowSeconds -> TimestampCheck.IN_FUTURE
        timestamp < nowSeconds - SCROBBLE_WINDOW.seconds -> TimestampCheck.TOO_OLD
        else -> TimestampCheck.ACCEPTABLE
    }
}
