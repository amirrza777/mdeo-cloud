package com.mdeo.backend.git.ssh

import com.mdeo.common.model.User
import org.apache.sshd.common.AttributeRepository

/**
 * Session attribute [GitSshPublickeyAuthenticator] stores the resolved user
 * under, once public key authentication succeeds, for [GitSshCommandFactory]
 * to read back when the client's subsequent `exec` request arrives on the
 * same session.
 */
internal val AUTHENTICATED_USER_KEY = AttributeRepository.AttributeKey<User>()
