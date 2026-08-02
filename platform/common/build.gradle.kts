plugins {
    alias(libs.plugins.kotlin.jvm)
    alias(libs.plugins.kotlin.serialization)
}

dependencies {
    api(libs.kotlinx.serialization.json)

    // WebSocket transport for the shared execution protocol: the client side is used by the
    // backend, the server side by the execution services. Exposed as `api` so consumers of
    // the protocol do not have to repeat them.
    api(libs.ktor.client.core)
    api(libs.ktor.client.cio)
    api(libs.ktor.client.websockets)
    api(libs.ktor.server.core)
    api(libs.ktor.server.websockets)
    api(libs.kotlinx.coroutines.core)

    implementation(libs.logback)

    testImplementation(libs.kotlin.test.junit5)
    testImplementation(libs.junit.jupiter)
}
