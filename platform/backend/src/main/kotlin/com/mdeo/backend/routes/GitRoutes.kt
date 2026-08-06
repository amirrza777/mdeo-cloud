package com.mdeo.backend.routes

import com.mdeo.backend.git.GitRepositoryService
import com.mdeo.backend.service.ProjectPermission
import com.mdeo.backend.service.ProjectService
import com.mdeo.backend.service.UserService
import com.mdeo.common.model.UserRoles
import io.ktor.http.*
import io.ktor.server.application.*
import io.ktor.server.request.*
import io.ktor.server.response.*
import io.ktor.server.routing.*
import io.ktor.utils.io.jvm.javaio.*
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.transport.RefAdvertiser
import org.eclipse.jgit.transport.UploadPack
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.UUID

/**
 * Serves projects as git repositories over git's smart HTTP protocol.
 *
 * A client asks for the refs first, then posts a request describing what it
 * already has and wants. JGit's [UploadPack] implements both halves; all that
 * is needed here is to hand it the streams and get the framing right.
 *
 * These routes deliberately do not use the session cookie. Git clients send
 * HTTP basic credentials, so the same MDEO username and password that works in
 * the browser works here, and nothing new has to be stored.
 *
 * @param gitRepositoryService Opens and publishes project repositories
 * @param projectService Used to check the caller may read the project
 * @param userService Used to verify basic credentials
 */
fun Route.gitRoutes(
    gitRepositoryService: GitRepositoryService,
    projectService: ProjectService,
    userService: UserService
) {
    route("/git/{projectId}") {
        /**
         * Ref advertisement, the first request of a clone or fetch.
         */
        get("/info/refs") {
            val service = call.request.queryParameters["service"]
            if (service != "git-upload-pack") {
                // Push is not served yet. Saying so plainly is better than a
                // protocol error the client would report as a broken remote.
                call.respond(HttpStatusCode.Forbidden, "Only git-upload-pack is supported")
                return@get
            }

            val projectId = call.authorizeGitRead(projectService, userService) ?: return@get

            val repository = gitRepositoryService.openRepository(projectId)
            repository.use {
                val body = ByteArrayOutputStream()
                // The advertisement opens with a packet naming the service, then
                // a flush packet, before the refs themselves.
                writePacket(body, "# service=git-upload-pack\n")
                body.write(FLUSH_PACKET)

                val uploadPack = UploadPack(repository)
                uploadPack.setBiDirectionalPipe(false)
                val advertiser = RefAdvertiser.PacketLineOutRefAdvertiser(
                    org.eclipse.jgit.transport.PacketLineOut(body)
                )
                uploadPack.sendAdvertisedRefs(advertiser)

                call.respondBytes(
                    body.toByteArray(),
                    ContentType.parse("application/x-git-upload-pack-advertisement")
                )
            }
        }

        /**
         * The negotiation and pack transfer itself.
         */
        post("/git-upload-pack") {
            val projectId = call.authorizeGitRead(projectService, userService) ?: return@post

            val repository = gitRepositoryService.openRepository(projectId)
            val requestBody = call.receiveStream().readBytes()

            call.respondOutputStream(
                ContentType.parse("application/x-git-upload-pack-result")
            ) {
                repository.use {
                    val uploadPack = UploadPack(repository)
                    uploadPack.setBiDirectionalPipe(false)
                    uploadPack.upload(requestBody.inputStream(), this, null)
                }
            }
        }
    }
}

/**
 * A git flush packet, which terminates a section of the protocol.
 */
private val FLUSH_PACKET = "0000".toByteArray(Charsets.US_ASCII)

/**
 * Writes one pkt-line: a four digit hex length covering the line and its own
 * header, followed by the payload.
 *
 * @param out Where to write the packet
 * @param line The payload, which should already end in a newline
 */
private fun writePacket(out: ByteArrayOutputStream, line: String) {
    val payload = line.toByteArray(Charsets.UTF_8)
    val length = payload.size + 4
    out.write(String.format("%04x", length).toByteArray(Charsets.US_ASCII))
    out.write(payload)
}

/**
 * Resolves the project from the route and checks the caller may read it.
 *
 * Git has no way to present a session, so credentials arrive as HTTP basic. A
 * failure returns the `WWW-Authenticate` challenge git expects, which is what
 * makes a client prompt for a username and password rather than simply fail.
 *
 * @param projectService Used to check project permissions
 * @param userService Used to verify the supplied credentials
 * @return The project id when access is allowed, or null when a response has
 *   already been sent
 */
private suspend fun ApplicationCall.authorizeGitRead(
    projectService: ProjectService,
    userService: UserService
): UUID? {
    val projectId = parameters["projectId"]
        ?.removeSuffix(".git")
        ?.let { runCatching { UUID.fromString(it) }.getOrNull() }
    if (projectId == null) {
        respond(HttpStatusCode.NotFound, "Unknown repository")
        return null
    }

    val header = request.headers[HttpHeaders.Authorization]
    val credentials = header?.takeIf { it.startsWith("Basic ", ignoreCase = true) }
        ?.substringAfter(' ')
        ?.let { runCatching { String(Base64.getDecoder().decode(it), Charsets.UTF_8) }.getOrNull() }

    if (credentials == null) {
        response.header(HttpHeaders.WWWAuthenticate, "Basic realm=\"MDEO Cloud\"")
        respond(HttpStatusCode.Unauthorized, "Authentication required")
        return null
    }

    val username = credentials.substringBefore(':')
    val password = credentials.substringAfter(':', "")
    val user = userService.verifyPassword(username, password)
    if (user == null) {
        response.header(HttpHeaders.WWWAuthenticate, "Basic realm=\"MDEO Cloud\"")
        respond(HttpStatusCode.Unauthorized, "Invalid credentials")
        return null
    }

    val userId = runCatching { UUID.fromString(user.id) }.getOrNull()
    if (userId == null || !projectService.hasProjectPermission(
            projectId,
            userId,
            user.roles.contains(UserRoles.ADMIN),
            ProjectPermission.READ
        )
    ) {
        // Deliberately the same answer as an unknown project, so this cannot be
        // used to discover which project ids exist.
        respond(HttpStatusCode.NotFound, "Unknown repository")
        return null
    }

    return projectId
}
