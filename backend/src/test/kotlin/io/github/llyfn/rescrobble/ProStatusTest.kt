package io.github.llyfn.rescrobble

import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.post
import io.ktor.client.request.setBody
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.server.testing.ApplicationTestBuilder
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlin.test.Test
import kotlin.test.assertEquals

class ProStatusTest {
    private fun lastFmWithUserInfo(userInfo: String) = LastFmFake { method, _ ->
        when (method) {
            "auth.getSession" -> lastFmJson(sessionJson("rj", "session-key-123"))
            "user.getInfo" -> lastFmJson(userInfo)
            else -> error("unexpected Last.fm method $method")
        }
    }

    private suspend fun ApplicationTestBuilder.pro(): String {
        val body = browser().post("/auth/session") {
            contentType(ContentType.Application.Json)
            setBody("""{"token":"approval"}""")
        }.bodyAsText()
        val token = Json.parseToJsonElement(body).jsonObject.getValue("token").jsonPrimitive.content
        val me = browser().get("/api/me") { header(HttpHeaders.Authorization, "Bearer $token") }.bodyAsText()
        return Json.parseToJsonElement(me).jsonObject.getValue("pro").toString()
    }

    @Test
    fun `a subscriber is reported as Pro`() = rescrobbleTest(lastFm = lastFmWithUserInfo(userInfoJson("rj", subscriber = "1")).engine) {
        assertEquals("true", pro())
    }

    @Test
    fun `a non-subscriber is reported as not Pro`() = rescrobbleTest(lastFm = lastFmWithUserInfo(userInfoJson("rj", subscriber = "0")).engine) {
        assertEquals("false", pro())
    }

    @Test
    fun `a numeric subscriber flag is read the same way`() = rescrobbleTest(
        lastFm = lastFmWithUserInfo("""{"user":{"name":"rj","subscriber":1}}""").engine,
    ) {
        assertEquals("true", pro())
    }

    @Test
    fun `a missing subscriber field leaves Pro unknown`() = rescrobbleTest(
        lastFm = lastFmWithUserInfo("""{"user":{"name":"rj","playcount":"1234"}}""").engine,
    ) {
        assertEquals("null", pro())
    }

    @Test
    fun `an unrecognised subscriber value leaves Pro unknown`() = rescrobbleTest(
        lastFm = lastFmWithUserInfo(userInfoJson("rj", subscriber = "maybe")).engine,
    ) {
        assertEquals("null", pro())
    }
}
