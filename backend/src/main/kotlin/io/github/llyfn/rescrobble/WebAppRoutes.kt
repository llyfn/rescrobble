package io.github.llyfn.rescrobble

import io.ktor.http.HttpStatusCode
import io.ktor.server.http.content.staticFiles
import io.ktor.server.response.respond
import io.ktor.server.routing.Route
import io.ktor.server.routing.route
import java.nio.file.Path

/**
 * Serves the built Web App, answering any other path with its entry page so client-side routes
 * survive deep links and refreshes. Unknown API and auth paths stay 404s: a constant-prefix
 * catch-all outranks the root catch-all in Ktor's routing.
 */
fun Route.webAppRoutes(webAppDir: Path) {
    for (prefix in listOf("/api", "/auth")) {
        route(prefix) {
            route("{...}") { handle { call.respond(HttpStatusCode.NotFound) } }
        }
    }
    staticFiles("/", webAppDir.toFile()) {
        default("index.html")
    }
}
