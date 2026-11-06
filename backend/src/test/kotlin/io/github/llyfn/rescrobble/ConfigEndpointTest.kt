package io.github.llyfn.rescrobble

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.HttpHeaders
import io.ktor.http.HttpStatusCode
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConfigEndpointTest {
    @Test
    fun `config returns the public API key without signing in`() = rescrobbleTest {
        val response = browser().get("/api/config")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("""{"lastFmApiKey":"test-api-key"}""", response.bodyAsText())
    }

    @Test
    fun `config never exposes the shared secret or the session encryption key`() = rescrobbleTest {
        val body = browser().get("/api/config").bodyAsText()

        assertTrue("test-shared-secret" !in body)
        assertTrue(testEnvironment.getValue("SESSION_ENCRYPTION_KEY") !in body)
    }

    @Test
    fun `config may be cached`() = rescrobbleTest {
        assertEquals("public, max-age=3600", browser().get("/api/config").headers[HttpHeaders.CacheControl])
    }
}
