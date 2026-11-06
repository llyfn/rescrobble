plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
    application
}

group = "io.github.llyfn.rescrobble"

kotlin {
    jvmToolchain(25)
}

application {
    mainClass = "io.github.llyfn.rescrobble.ApplicationKt"
    // Netty loads native transports; JDK 24+ warns on restricted native access otherwise.
    applicationDefaultJvmArgs = listOf("--enable-native-access=ALL-UNNAMED")
}

repositories {
    mavenCentral()
}

dependencies {
    implementation(libs.ktor.server.core)
    implementation(libs.ktor.server.netty)
    implementation(libs.ktor.server.sessions)
    implementation(libs.ktor.server.content.negotiation)
    implementation(libs.ktor.server.forwarded.header)
    implementation(libs.ktor.serialization.kotlinx.json)
    implementation(libs.ktor.client.core)
    implementation(libs.ktor.client.cio)
    implementation(libs.logback.classic)

    testImplementation(kotlin("test"))
    testImplementation(libs.ktor.server.test.host)
    testImplementation(libs.ktor.client.mock)
    testRuntimeOnly("org.junit.platform:junit-platform-launcher")
}

// Test cases shared with the TypeScript clients.
sourceSets.test {
    resources.srcDir("../fixtures")
}

tasks.test {
    useJUnitPlatform()
}
