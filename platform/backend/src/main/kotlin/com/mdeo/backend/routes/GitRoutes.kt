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
import org.eclipse.jgit.errors.UnpackException
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.transport.PacketLineOut
import org.eclipse.jgit.transport.ReceiveCommand
import org.eclipse.jgit.transport.ReceivePack
import org.eclipse.jgit.transport.RefAdvertiser
import org.eclipse.jgit.transport.UploadPack
import org.slf4j.LoggerFactory
import java.io.ByteArrayOutputStream
import java.util.Base64
import java.util.UUID

private val logger = LoggerFactory.getLogger("GitRoutes")

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
 * @param maxPushPackSizeBytes Largest pack a push may send; see [com.mdeo.backend.config.GitConfig]
 */
fun Route.gitRoutes(
    gitRepositoryService: GitRepositoryService,
    projectService: ProjectService,
    userService: UserService,
    maxPushPackSizeBytes: Long
) {
    route("/git/{projectId}") {
        /**
         * Ref advertisement, the first request of a clone or fetch.
         */
        get("/info/refs") {
            val service = call.request.queryParameters["service"]
            if (service != "git-upload-pack" && service != "git-receive-pack") {
                call.respond(HttpStatusCode.Forbidden, "Unsupported service")
                return@get
            }

            // Advertising for a push already reveals the caller intends to
            // write, so it is gated on write permission rather than read.
            val permission =
                if (service == "git-receive-pack") ProjectPermission.WRITE else ProjectPermission.READ
            val projectId = call.authorizeGit(projectService, userService, permission) ?: return@get

            val repository = gitRepositoryService.openRepository(projectId)
            repository.use {
                val body = ByteArrayOutputStream()
                // The advertisement opens with a packet naming the service, then
                // a flush packet, before the refs themselves.
                writePacket(body, "# service=$service\n")
                body.write(FLUSH_PACKET)

                val advertiser = RefAdvertiser.PacketLineOutRefAdvertiser(PacketLineOut(body))
                if (service == "git-upload-pack") {
                    UploadPack(repository).apply {
                        setBiDirectionalPipe(false)
                        sendAdvertisedRefs(advertiser)
                    }
                } else {
                    ReceivePack(repository).apply {
                        setBiDirectionalPipe(false)
                        sendAdvertisedRefs(advertiser)
                    }
                }

                call.respondBytes(
                    body.toByteArray(),
                    ContentType.parse("application/x-$service-advertisement")
                )
            }
        }

        /**
         * The negotiation and pack transfer itself.
         */
        post("/git-upload-pack") {
            val projectId =
                call.authorizeGit(projectService, userService, ProjectPermission.READ) ?: return@post

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

        /**
         * Receiving a push.
         */
        post("/git-receive-pack") {
            val projectId =
                call.authorizeGit(projectService, userService, ProjectPermission.WRITE) ?: return@post

            val repository = gitRepositoryService.openRepository(projectId)
            val requestBody = call.receiveStream().readBytes()

            call.respondOutputStream(
                ContentType.parse("application/x-git-receive-pack-result")
            ) {
                repository.use {
                    val receivePack = ReceivePack(repository)
                    receivePack.setBiDirectionalPipe(false)
                    // Checked while unpacking, before any command runs, so an
                    // oversized push is refused outright rather than applying
                    // some of its files before running out of room.
                    receivePack.setMaxPackSizeLimit(maxPushPackSizeBytes)
                    // A push that is not a fast forward is refused, and the user
                    // merges locally with tools they already know. That is what
                    // removes the need for any conflict resolution here.
                    receivePack.isAllowNonFastForwards = false

                    receivePack.setPreReceiveHook { _, commands ->
                        for (command in commands) {
                            if (command.refName != gitRepositoryService.branch) {
                                command.setResult(
                                    ReceiveCommand.Result.REJECTED_OTHER_REASON,
                                    "only ${gitRepositoryService.branch} can be pushed, " +
                                        "a project has one set of files rather than one per branch"
                                )
                                continue
                            }
                            if (command.type == ReceiveCommand.Type.DELETE) {
                                command.setResult(
                                    ReceiveCommand.Result.REJECTED_OTHER_REASON,
                                    "the project branch cannot be deleted"
                                )
                                continue
                            }
                            // Applied before the ref moves, so a push that cannot
                            // be written into the project is refused outright
                            // rather than leaving the branch ahead of the files.
                            val failure = gitRepositoryService.applyCommitToProject(
                                repository,
                                projectId,
                                command.newId
                            )
                            if (failure != null) {
                                command.setResult(ReceiveCommand.Result.REJECTED_OTHER_REASON, failure)
                            }
                        }
                    }

                    try {
                        receivePack.receive(requestBody.inputStream(), this, null)
                    } catch (e: UnpackException) {
                        // JGit already wrote the rejection (for instance
                        // exceeding the size limit above) into the response
                        // as a normal git status report before throwing this,
                        // so the client already saw a clean error. Without
                        // this catch it would also reach the application's
                        // generic handler and log as a 500, which reads as a
                        // server crash rather than the expected rejection of
                        // an oversized or malformed push that it is.
                        logger.info("Rejected push for project {}: {}", projectId, e.message)
                    }
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
 * @param permission The permission the caller needs on the project
 * @return The project id when access is allowed, or null when a response has
 *   already been sent
 */
private suspend fun ApplicationCall.authorizeGit(
    projectService: ProjectService,
    userService: UserService,
    permission: ProjectPermission
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
            permission
        )
    ) {
        // Deliberately the same answer as an unknown project, so this cannot be
        // used to discover which project ids exist.
        respond(HttpStatusCode.NotFound, "Unknown repository")
        return null
    }

    return projectId
}
