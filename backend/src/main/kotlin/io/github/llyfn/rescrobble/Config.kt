package io.github.llyfn.rescrobble

import java.util.Base64

class Config(
    val lastFmApiKey: String,
    val lastFmSharedSecret: String,
    val sessionEncryptionKey: ByteArray,
    val publicBaseUrl: String,
    val extensionId: String,
    val port: Int,
) {
    companion object {
        private const val DEFAULT_PORT = 8080
        private const val SESSION_KEY_BYTES = 32

        fun fromEnvironment(env: Map<String, String>): Config {
            val required = listOf(
                "LASTFM_API_KEY",
                "LASTFM_SHARED_SECRET",
                "SESSION_ENCRYPTION_KEY",
                "PUBLIC_BASE_URL",
                "EXTENSION_ID",
            )
            val missing = required.filter { env[it].isNullOrBlank() }
            if (missing.isNotEmpty()) throw MissingConfigException(missing)

            val port = env["PORT"]?.let {
                it.toIntOrNull() ?: throw IllegalStateException("PORT must be an integer, got '$it'")
            } ?: DEFAULT_PORT

            val sessionEncryptionKey = runCatching { Base64.getDecoder().decode(env.getValue("SESSION_ENCRYPTION_KEY")) }
                .getOrNull()
                ?.takeIf { it.size == SESSION_KEY_BYTES }
                ?: throw IllegalStateException("SESSION_ENCRYPTION_KEY must be $SESSION_KEY_BYTES random bytes, base64-encoded")

            return Config(
                lastFmApiKey = env.getValue("LASTFM_API_KEY"),
                lastFmSharedSecret = env.getValue("LASTFM_SHARED_SECRET"),
                sessionEncryptionKey = sessionEncryptionKey,
                publicBaseUrl = env.getValue("PUBLIC_BASE_URL").trimEnd('/'),
                extensionId = env.getValue("EXTENSION_ID"),
                port = port,
            )
        }
    }
}

class MissingConfigException(val names: List<String>) :
    IllegalStateException("Missing required configuration: ${names.joinToString()}")
