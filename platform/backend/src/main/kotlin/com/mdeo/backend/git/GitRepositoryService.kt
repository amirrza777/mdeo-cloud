package com.mdeo.backend.git

import com.mdeo.backend.database.FilesTable
import com.mdeo.backend.service.FileService
import com.mdeo.common.model.ApiResult
import com.mdeo.common.model.FileType
import org.eclipse.jgit.dircache.DirCache
import org.eclipse.jgit.dircache.DirCacheEntry
import org.eclipse.jgit.lib.CommitBuilder
import org.eclipse.jgit.lib.Constants
import org.eclipse.jgit.lib.FileMode
import org.eclipse.jgit.lib.ObjectId
import org.eclipse.jgit.lib.PersonIdent
import org.eclipse.jgit.lib.RefUpdate
import org.eclipse.jgit.revwalk.RevWalk
import org.eclipse.jgit.treewalk.TreeWalk
import org.jetbrains.exposed.v1.core.*
import org.jetbrains.exposed.v1.jdbc.*
import org.jetbrains.exposed.v1.jdbc.transactions.transaction
import org.slf4j.LoggerFactory
import java.time.Instant
import java.util.Base64
import java.util.UUID
import kotlin.uuid.toKotlinUuid

/**
 * Exposes projects as git repositories.
 *
 * A project's files live in Postgres and are edited live, so there is no commit
 * history to draw on. History is instead appended when someone looks: before a
 * repository is served, the current file state is written as a commit if it
 * differs from what the branch already points at. That gives an append only
 * history with a boundary nobody has to choose, and it means identical content
 * never produces a second commit.
 */
class GitRepositoryService(
    private val fileService: FileService
) {
    private val logger = LoggerFactory.getLogger(GitRepositoryService::class.java)

    /**
     * Branch a project's files are published on, and the only one a push may
     * target. Anything else would have no meaning: the project has one set of
     * files, not one per branch.
     */
    val branch = "refs/heads/main"

    /**
     * Identity recorded on generated commits.
     *
     * These commits are made by the server on behalf of everyone who edited the
     * project, not by one person, so attributing them to an individual would be
     * misleading.
     */
    private val author = PersonIdent("MDEO Cloud", "mdeo-cloud@localhost")

    /**
     * Opens a project's repository, creating it if this is the first access.
     *
     * @param projectId The project to open
     * @return The repository, with its files published on [branch]
     */
    fun openRepository(projectId: UUID): PostgresDfsRepository {
        val repository = PostgresDfsRepository(projectId)
        if (!repository.objectDatabase.exists()) {
            repository.create(true)
        }
        publishCurrentFiles(repository, projectId)
        return repository
    }

    /**
     * Writes the project's current files as a commit, unless the branch already
     * points at exactly this content.
     *
     * @param repository The project's repository
     * @param projectId The project whose files should be published
     * @return The commit now at the head of [branch], or null if there are no files
     */
    private fun publishCurrentFiles(repository: PostgresDfsRepository, projectId: UUID): ObjectId? {
        val files = readProjectFiles(projectId)
        if (files.isEmpty()) {
            return null
        }

        val currentHead: ObjectId? = repository.resolve(branch)

        repository.newObjectInserter().use { inserter ->
            // DirCache builds the nested trees from flat paths, so directories
            // in the files table do not need to be walked. Git infers them.
            val dirCache = DirCache.newInCore()
            val builder = dirCache.builder()
            for ((path, content) in files) {
                val entry = DirCacheEntry(path)
                entry.fileMode = FileMode.REGULAR_FILE
                entry.setObjectId(inserter.insert(Constants.OBJ_BLOB, content))
                builder.add(entry)
            }
            builder.finish()
            val treeId = dirCache.writeTree(inserter)

            if (currentHead != null && treeOf(repository, currentHead) == treeId) {
                // Nothing changed since the last time anyone looked.
                return currentHead
            }

            // Built before entering the builder, because inside `apply` an
            // unqualified `author` would bind to CommitBuilder's own property
            // rather than to this service's.
            val identity = PersonIdent(author, Instant.now())
            val commit = CommitBuilder().apply {
                setTreeId(treeId)
                if (currentHead != null) {
                    setParentId(currentHead)
                }
                setAuthor(identity)
                setCommitter(identity)
                message = if (currentHead == null) {
                    "Initial project contents\n"
                } else {
                    "Project contents as of this fetch\n"
                }
            }
            val commitId = inserter.insert(commit)
            inserter.flush()

            val update = repository.updateRef(branch)
            update.setNewObjectId(commitId)
            update.setExpectedOldObjectId(currentHead ?: ObjectId.zeroId())
            val result = update.update()
            if (result != RefUpdate.Result.NEW && result != RefUpdate.Result.FAST_FORWARD) {
                // Another request published first. Its commit is just as valid,
                // so take whatever is there now rather than retrying.
                logger.debug("Ref update for project {} returned {}", projectId, result)
                return repository.resolve(branch)
            }
            return commitId
        }
    }

    /**
     * Writes the contents of a pushed commit back into the project's files.
     *
     * Every path in the commit is written through the ordinary file service, so
     * a push goes through exactly the same validation, version bump and project
     * locking as an edit made in the workbench. Files the commit no longer
     * contains are deleted, which is what makes a push replace the project
     * rather than only add to it.
     *
     * Note that clients with the project open are not told about this. The
     * platform has no file change broadcast at all today, so an edit made in
     * one browser tab is equally invisible to another. That is a gap worth
     * closing, but it is not specific to pushing.
     *
     * @param repository The project's repository, holding the pushed objects
     * @param projectId The project to update
     * @param commitId The commit whose contents should become the project
     * @return null on success, or a message describing why the push cannot be
     *   applied
     */
    fun applyCommitToProject(
        repository: PostgresDfsRepository,
        projectId: UUID,
        commitId: ObjectId
    ): String? {
        val pushed = mutableMapOf<String, ByteArray>()
        try {
            RevWalk(repository).use { walk ->
                val tree = walk.parseCommit(commitId).tree
                TreeWalk(repository).use { treeWalk ->
                    treeWalk.addTree(tree)
                    treeWalk.isRecursive = true
                    while (treeWalk.next()) {
                        val loader = repository.open(treeWalk.getObjectId(0))
                        pushed[treeWalk.pathString] = loader.bytes
                    }
                }
            }
        } catch (e: Exception) {
            logger.warn("Could not read pushed commit {} for project {}", commitId.name, projectId, e)
            return "could not read the pushed commit"
        }

        val existing = readProjectFiles(projectId).map { it.first }.toSet()

        for ((path, content) in pushed) {
            val result = fileService.writeFile(projectId, path, content, create = true, overwrite = true)
            if (result is ApiResult.Failure) {
                return "could not write $path: ${result.error.message}"
            }
        }

        for (path in existing - pushed.keys) {
            val result = fileService.delete(projectId, path, recursive = false)
            if (result is ApiResult.Failure) {
                return "could not delete $path: ${result.error.message}"
            }
        }

        return null
    }

    /**
     * Reads the tree a commit points at.
     *
     * @param repository The repository to read from
     * @param commitId The commit to inspect
     * @return The commit's tree id, or null if the commit cannot be read
     */
    private fun treeOf(repository: PostgresDfsRepository, commitId: ObjectId): ObjectId? =
        try {
            RevWalk(repository).use { walk -> walk.parseCommit(commitId).tree.id }
        } catch (_: Exception) {
            null
        }

    /**
     * Reads every file of a project, with its decoded contents.
     *
     * Directories are skipped: git records only files, and infers the
     * directories from their paths. File contents are held base64 encoded in a
     * text column, so they are decoded back to bytes here, which also means
     * binary files survive the round trip.
     *
     * @param projectId The project to read
     * @return Path to contents, for every file in the project
     */
    private fun readProjectFiles(projectId: UUID): List<Pair<String, ByteArray>> {
        val project = projectId.toKotlinUuid()
        return transaction {
            FilesTable
                .selectAll()
                .where {
                    (FilesTable.projectId eq project) and (FilesTable.fileType eq FileType.FILE)
                }
                .mapNotNull { row ->
                    val path = row[FilesTable.path].trimStart('/')
                    if (path.isEmpty()) {
                        return@mapNotNull null
                    }
                    val encoded = row[FilesTable.content] ?: ""
                    val bytes = if (encoded.isEmpty()) {
                        ByteArray(0)
                    } else {
                        Base64.getDecoder().decode(encoded)
                    }
                    path to bytes
                }
        }
    }
}
