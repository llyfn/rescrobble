package io.github.llyfn.rescrobble

import io.ktor.client.request.get
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals

class HealthTest {
    @Test
    fun `health check responds ok`() = rescrobbleTest {
        val response = client.get("/health")

        assertEquals(HttpStatusCode.OK, response.status)
    }
}
