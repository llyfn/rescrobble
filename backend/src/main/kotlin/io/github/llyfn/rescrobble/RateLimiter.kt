package io.github.llyfn.rescrobble

import java.time.Clock
import java.time.Duration
import java.time.Instant

class RateLimits(
    /** Roughly Last.fm's observed per-account daily scrobble limit; not documented by Last.fm. */
    val dailyScrobbles: Int = 2800,
    val dailyWindow: Duration = Duration.ofHours(24),
    val burstRequests: Int = 10,
    val burstWindow: Duration = Duration.ofSeconds(10),
)

/**
 * Per-account limits kept in memory, so they hold only while the service runs as a single instance.
 * Keyed by the Last.fm session key, which identifies one approval of rescrobble by one account.
 */
class RateLimiter(private val clock: Clock, private val limits: RateLimits = RateLimits()) {
    class Reservation internal constructor(internal val key: String, internal val at: Instant, internal val scrobbles: Int)

    sealed interface Decision {
        class Allowed(val reservation: Reservation) : Decision
        class Denied(val reason: String, val retryAfter: Duration) : Decision
    }

    private class Usage {
        val requests = ArrayDeque<Instant>()
        val scrobbles = ArrayDeque<Reservation>()
    }

    private val usage = mutableMapOf<String, Usage>()

    @Synchronized
    fun tryAcquire(key: String, scrobbles: Int): Decision {
        val now = clock.instant()
        val account = usage.getOrPut(key) { Usage() }
        account.requests.removeWhile { it <= now - limits.burstWindow }
        account.scrobbles.removeWhile { it.at <= now - limits.dailyWindow }

        if (account.requests.size >= limits.burstRequests) {
            return Decision.Denied("tooManyRequests", Duration.between(now, account.requests.first() + limits.burstWindow))
        }
        val used = account.scrobbles.sumOf { it.scrobbles }
        if (used + scrobbles > limits.dailyScrobbles) {
            return Decision.Denied("dailyLimit", retryAfterDaily(account, used + scrobbles - limits.dailyScrobbles, now))
        }

        val reservation = Reservation(key, now, scrobbles)
        account.requests.addLast(now)
        if (scrobbles > 0) account.scrobbles.addLast(reservation)
        return Decision.Allowed(reservation)
    }

    /** Returns Scrobbles that never reached Last.fm to the account's allowance. */
    @Synchronized
    fun refund(reservation: Reservation) {
        usage[reservation.key]?.scrobbles?.remove(reservation)
    }

    private fun retryAfterDaily(account: Usage, excess: Int, now: Instant): Duration {
        var freed = 0
        for (reservation in account.scrobbles) {
            freed += reservation.scrobbles
            if (freed >= excess) return Duration.between(now, reservation.at + limits.dailyWindow)
        }
        return limits.dailyWindow
    }

    private inline fun <T> ArrayDeque<T>.removeWhile(predicate: (T) -> Boolean) {
        while (isNotEmpty() && predicate(first())) removeFirst()
    }
}
