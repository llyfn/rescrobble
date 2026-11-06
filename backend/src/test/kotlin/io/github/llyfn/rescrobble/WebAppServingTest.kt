package io.github.llyfn.rescrobble

import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.HttpStatusCode
import io.ktor.http.contentType
import java.nio.file.Files
import java.nio.file.Path
import kotlin.io.path.createDirectories
import kotlin.io.path.writeText
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith

class WebAppServingTest {
    private val webApp: Path = Files.createTempDirectory("web-app").also { dir ->
        dir.resolve("index.html").writeText("<!doctype html><title>rescrobble</title>")
        dir.resolve("assets").createDirectories()
        dir.resolve("assets/app.js").writeText("console.log('rescrobble')")
        dir.resolve("assets/app.css").writeText("body{}")
    }

    private val config = Config.fromEnvironment(testEnvironment + ("WEB_APP_DIR" to webApp.toString()))

    @Test
    fun `the entry page is served at the root`() = rescrobbleTest(config = config) {
        val response = browser().get("/")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals(ContentType.Text.Html, response.contentType()?.withoutParameters())
        assertEquals("<!doctype html><title>rescrobble</title>", response.bodyAsText())
    }

    @Test
    fun `static files are served with their content types`() = rescrobbleTest(config = config) {
        val script = browser().get("/assets/app.js")
        val style = browser().get("/assets/app.css")

        assertEquals("console.log('rescrobble')", script.bodyAsText())
        assertEquals(ContentType.Text.JavaScript, script.contentType()?.withoutParameters())
        assertEquals(ContentType.Text.CSS, style.contentType()?.withoutParameters())
    }

    @Test
    fun `a deep link inside the Web App falls back to the entry page`() = rescrobbleTest(config = config) {
        val response = browser().get("/scrobble/album?artist=Cher")

        assertEquals(HttpStatusCode.OK, response.status)
        assertEquals("<!doctype html><title>rescrobble</title>", response.bodyAsText())
    }

    @Test
    fun `unknown API and auth paths stay 404`() = rescrobbleTest(config = config) {
        for (path in listOf("/api/unknown", "/api/me/extra", "/auth/unknown", "/api", "/auth")) {
            assertEquals(HttpStatusCode.NotFound, browser().get(path).status, path)
        }
    }

    @Test
    fun `API, auth and health routes still answer alongside the Web App`() = rescrobbleTest(config = config) {
        assertEquals("ok", browser().get("/health").bodyAsText())
        assertEquals(HttpStatusCode.Unauthorized, browser().get("/api/me").status)
        assertEquals(HttpStatusCode.Found, browser().get("/auth/login").status)
    }

    @Test
    fun `files outside the Web App folder are never served`() = rescrobbleTest(config = config) {
        val secret = webApp.parent.resolve("outside-${webApp.fileName}.txt").also { it.writeText("secret") }

        val response = browser().get("/../${secret.fileName}")

        assertEquals("<!doctype html><title>rescrobble</title>", response.bodyAsText())
    }

    @Test
    fun `without a Web App folder only the API is served`() = rescrobbleTest {
        assertEquals(HttpStatusCode.NotFound, browser().get("/").status)
        assertEquals("ok", browser().get("/health").bodyAsText())
    }

    @Test
    fun `a Web App folder without an entry page is refused at startup`() {
        val empty = Files.createTempDirectory("empty-web-app")

        assertFailsWith<IllegalStateException> {
            Config.fromEnvironment(testEnvironment + ("WEB_APP_DIR" to empty.toString()))
        }
    }
}
