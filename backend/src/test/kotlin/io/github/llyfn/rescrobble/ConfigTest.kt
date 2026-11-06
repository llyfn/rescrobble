package io.github.llyfn.rescrobble

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class ConfigTest {
    @Test
    fun `loads every required value from the environment`() {
        val config = Config.fromEnvironment(testEnvironment)

        assertEquals("test-api-key", config.lastFmApiKey)
        assertEquals("test-shared-secret", config.lastFmSharedSecret)
        assertEquals((0 until 32).map { it.toByte() }, config.sessionEncryptionKey.toList())
        assertEquals("https://rescrobble.test", config.publicBaseUrl)
        assertEquals("testextensionid", config.extensionId)
    }

    @Test
    fun `port defaults to 8080 when not set`() {
        assertEquals(8080, Config.fromEnvironment(testEnvironment).port)
    }

    @Test
    fun `port is read from the environment when set`() {
        assertEquals(9000, Config.fromEnvironment(testEnvironment + ("PORT" to "9000")).port)
    }

    @Test
    fun `a non-numeric port is refused`() {
        assertFailsWith<IllegalStateException> {
            Config.fromEnvironment(testEnvironment + ("PORT" to "eighty"))
        }
    }

    @Test
    fun `a session encryption key that isn't 32 base64-encoded bytes is refused`() {
        for (key in listOf("not base64!", "AAECAwQFBgcICQoLDA0ODw==")) {
            assertFailsWith<IllegalStateException>(key) {
                Config.fromEnvironment(testEnvironment + ("SESSION_ENCRYPTION_KEY" to key))
            }
        }
    }

    @Test
    fun `a trailing slash on the public base URL is dropped`() {
        val config = Config.fromEnvironment(testEnvironment + ("PUBLIC_BASE_URL" to "https://rescrobble.test/"))

        assertEquals("https://rescrobble.test", config.publicBaseUrl)
    }

    @Test
    fun `names every missing required value at once`() {
        val env = testEnvironment - "LASTFM_SHARED_SECRET" - "EXTENSION_ID"

        val error = assertFailsWith<MissingConfigException> { Config.fromEnvironment(env) }

        assertEquals(listOf("LASTFM_SHARED_SECRET", "EXTENSION_ID"), error.names)
    }

    @Test
    fun `a blank value counts as missing`() {
        val env = testEnvironment + ("LASTFM_API_KEY" to "  ")

        val error = assertFailsWith<MissingConfigException> { Config.fromEnvironment(env) }

        assertEquals(listOf("LASTFM_API_KEY"), error.names)
    }
}
