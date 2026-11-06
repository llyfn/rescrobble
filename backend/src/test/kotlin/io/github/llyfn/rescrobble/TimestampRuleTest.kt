package io.github.llyfn.rescrobble

import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.time.Instant
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class TimestampRuleTest {
    @Serializable
    private class Case(val name: String, val now: Long, val timestamp: Long, val expected: String)

    @Serializable
    private class Cases(val description: String, val cases: List<Case>)

    private val cases = Json.decodeFromString<Cases>(
        javaClass.getResource("/timestamp-rule-cases.json")!!.readText(),
    ).cases

    private val expectedNames = mapOf(
        "acceptable" to TimestampCheck.ACCEPTABLE,
        "tooOld" to TimestampCheck.TOO_OLD,
        "inFuture" to TimestampCheck.IN_FUTURE,
    )

    @Test
    fun `every shared timestamp case is classified as expected`() {
        assertTrue(cases.isNotEmpty())
        for (case in cases) {
            assertEquals(
                expectedNames.getValue(case.expected),
                checkTimestamp(case.timestamp, Instant.ofEpochSecond(case.now)),
                case.name,
            )
        }
    }
}
