package com.mdeo.backend.git.ssh

import com.mdeo.backend.service.SshKeyService
import org.apache.sshd.server.auth.pubkey.PublickeyAuthenticator
import org.apache.sshd.server.session.ServerSession
import org.slf4j.LoggerFactory
import java.security.PublicKey

/**
 * Authenticates an SSH client by public key, looked up against
 * [SshKeyService]'s registered keys. The username the client offers is not
 * checked against anything - as with `git@github.com`, the key is what
 * identifies the caller, not the SSH username - so the same resolved user
 * is stored for [GitSshCommandFactory] regardless of what username was sent.
 *
 * @param sshKeyService Resolves an offered key to its owning user
 */
class GitSshPublickeyAuthenticator(private val sshKeyService: SshKeyService) : PublickeyAuthenticator {
    private val logger = LoggerFactory.getLogger(GitSshPublickeyAuthenticator::class.java)

    override fun authenticate(username: String, key: PublicKey, session: ServerSession): Boolean {
        val user = sshKeyService.findUserByPublicKey(key) ?: return false
        session.setAttribute(AUTHENTICATED_USER_KEY, user)
        logger.info("SSH public key authentication succeeded for user {}", user.username)
        return true
    }
}
