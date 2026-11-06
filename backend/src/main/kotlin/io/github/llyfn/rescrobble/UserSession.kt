package io.github.llyfn.rescrobble

import io.ktor.server.sessions.SessionTransportTransformer
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import java.security.SecureRandom
import java.util.Base64
import javax.crypto.Cipher
import javax.crypto.spec.GCMParameterSpec
import javax.crypto.spec.SecretKeySpec

/** Not a data class, so the session key can't leak through `toString`. */
@Serializable
class UserSession(val username: String, val sessionKey: String)

/** The Extension's bearer token: the same encrypted session the Web App's cookie carries. */
class SessionTokenCodec(private val transformer: AesGcmSessionTransformer) {
    fun encode(session: UserSession): String = transformer.transformWrite(Json.encodeToString(session))

    fun decode(token: String): UserSession? = transformer.transformRead(token)
        ?.let { runCatching { Json.decodeFromString<UserSession>(it) }.getOrNull() }
}

/**
 * Encrypts and authenticates the session with AES-256-GCM. A value that fails to decrypt
 * (tampered, truncated, or made with another key) reads as no session at all.
 */
class AesGcmSessionTransformer(key: ByteArray) : SessionTransportTransformer {
    private val key = SecretKeySpec(key, "AES")
    private val random = SecureRandom()

    override fun transformWrite(transportValue: String): String {
        val nonce = ByteArray(NONCE_BYTES).also(random::nextBytes)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.ENCRYPT_MODE, key, GCMParameterSpec(TAG_BITS, nonce))
        }
        return encoder.encodeToString(nonce + cipher.doFinal(transportValue.toByteArray(Charsets.UTF_8)))
    }

    override fun transformRead(transportValue: String): String? = runCatching {
        val bytes = decoder.decode(transportValue)
        val cipher = Cipher.getInstance(TRANSFORMATION).apply {
            init(Cipher.DECRYPT_MODE, key, GCMParameterSpec(TAG_BITS, bytes, 0, NONCE_BYTES))
        }
        String(cipher.doFinal(bytes, NONCE_BYTES, bytes.size - NONCE_BYTES), Charsets.UTF_8)
    }.getOrNull()

    private companion object {
        const val TRANSFORMATION = "AES/GCM/NoPadding"
        const val NONCE_BYTES = 12
        const val TAG_BITS = 128
        val encoder: Base64.Encoder = Base64.getUrlEncoder().withoutPadding()
        val decoder: Base64.Decoder = Base64.getUrlDecoder()
    }
}
