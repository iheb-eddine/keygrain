package com.secbytech.keygrain.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import org.json.JSONArray
import org.json.JSONObject
import java.io.File

/**
 * Sync v3 deletion reconciliation (designs/sync-deletion-reconciliation.md).
 *
 * These MUST stay behaviourally identical to the `reconcile*` tests in
 * extension/tests/test.mjs — the two platforms share one algorithm and any divergence is
 * a cross-platform correctness bug.
 *
 * [SyncReconciler.reconcileServices] is pure (no Context, no android.util.Base64, no
 * org.json construction on the paths exercised here), so it runs on the plain JVM unit
 * test runtime. Cases that would build a SyncConflict are deliberately shaped so the
 * material-difference check is false, because SyncConflict serialization needs org.json,
 * which is "not mocked" in this runtime.
 */
class SyncReconcileTest {

    private val sm = SyncManager()

    private fun svc(
        id: String,
        site: String = "example.com",
        email: String = "a@b.com",
        updatedAt: Long,
        synced: Boolean
    ) = ServiceEntry(
        name = site, site = site, email = email, updatedAt = updatedAt, id = id, synced = synced
    )

    private fun meta(vararg pairs: Pair<String, Long>): List<Pair<String?, Long>> =
        pairs.map { it.first as String? to it.second }

    // Rule 3: both sides have it, local newer wins.
    @Test
    fun rule3_localNewerWins() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("a", site = "local.com", updatedAt = 200, synced = true)),
            emptyList(),
            listOf(svc("a", site = "remote.com", updatedAt = 100, synced = true)),
            meta("a" to 100L), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals("local.com", r.merged[0].site)
        assertTrue(r.merged[0].synced)
    }

    // Rules 1+2: remote wins ties.
    @Test
    fun rules1and2_remoteWinsTies() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("a", site = "local.com", updatedAt = 100, synced = true)),
            emptyList(),
            listOf(svc("a", site = "remote.com", updatedAt = 100, synced = true)),
            meta("a" to 100L), 0L, true
        )
        assertEquals("remote.com", r.merged[0].site)
    }

    // Rule 5: remote-only is created locally.
    @Test
    fun rule5_remoteOnlyCreatesLocally() {
        val r = SyncReconciler.reconcileServices(
            emptyList(), emptyList(),
            listOf(svc("b", site = "new.com", updatedAt = 50, synced = false)),
            meta("b" to 50L), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals("b", r.merged[0].id)
        assertTrue(r.merged[0].synced)
    }

    // Rule 4: local-only and never synced is pushed, NEVER deleted.
    @Test
    fun rule4_unsyncedLocalOnlyIsPushedNotDeleted() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("local-1", site = "brand-new.com", updatedAt = 300, synced = false)),
            emptyList(), emptyList(), emptyList(), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals("brand-new.com", r.merged[0].site)
        assertEquals(0, r.review.size)
    }

    // Rule 6: synced local-only was deleted elsewhere.
    @Test
    fun rule6_syncedLocalOnlyIsDeleted() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("d", site = "gone.com", updatedAt = 100, synced = true)),
            emptyList(), emptyList(), emptyList(), 500L, true
        )
        assertEquals(0, r.merged.size)
    }

    // Frozen Req 7 negative: no unsynced change -> silent, nothing retained.
    @Test
    fun routineRemoteDeletionRetainsNothing() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("d", site = "gone.com", updatedAt = 100, synced = true)),
            emptyList(), emptyList(), emptyList(), 500L, true
        )
        assertEquals(0, r.review.size)
    }

    // Frozen Req 7: an unsynced local change destroyed by a remote deletion is retained.
    @Test
    fun remoteDeletionOfLocallyEditedServiceIsRetained() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("d", site = "edited.com", updatedAt = 900, synced = true)),
            emptyList(), emptyList(), emptyList(), 500L, true
        )
        assertEquals(0, r.merged.size)
        assertEquals(1, r.review.size)
        assertEquals("d", r.review[0].service.id)
    }

    // Rule 7: a newer remote edit supersedes a pending local deletion.
    @Test
    fun rule7_newerRemoteEditResurrectsOverTombstone() {
        val r = SyncReconciler.reconcileServices(
            emptyList(), listOf(Tombstone("x", 100L)),
            listOf(svc("x", site = "edited-elsewhere.com", updatedAt = 200, synced = true)),
            meta("x" to 200L), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals("x", r.merged[0].id)
        assertEquals(listOf("x"), r.resurrected)
        assertEquals(0, r.tombstones.size)
        assertEquals(0, r.deletedIds.size)
    }

    // Rule 7 negative: the deletion is newer -> stays deleted and is declared.
    @Test
    fun rule7_olderRemoteRecordStaysDeletedAndIsDeclared() {
        val r = SyncReconciler.reconcileServices(
            emptyList(), listOf(Tombstone("x", 300L)),
            listOf(svc("x", site = "stale.com", updatedAt = 200, synced = true)),
            meta("x" to 200L), 0L, true
        )
        assertEquals(0, r.merged.size)
        assertEquals(listOf("x"), r.deletedIds)
        assertEquals(1, r.tombstones.size)
    }

    // Frozen Req 5: a tombstone for an id the server no longer holds clears without a PUT.
    @Test
    fun tombstoneForAlreadyAbsentIdClearsWithoutPut() {
        val r = SyncReconciler.reconcileServices(
            emptyList(), listOf(Tombstone("x", 300L)), emptyList(), emptyList(), 0L, true
        )
        assertEquals(0, r.merged.size)
        assertEquals(0, r.tombstones.size)
        assertEquals(0, r.deletedIds.size)
    }

    // Lost PUT response: the server holds the record under the SAME client UUID, so it
    // matches by id — no duplicate, and the flag flips to synced.
    @Test
    fun lostPutResponseRepairsByIdWithoutDuplicating() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("same", updatedAt = 100, synced = false)),
            emptyList(),
            listOf(svc("same", updatedAt = 100, synced = false)),
            meta("same" to 100L), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals("same", r.merged[0].id)
        assertTrue(r.merged[0].synced)
    }

    // A deletion inside the lost-response window still propagates, because the tombstone
    // is written regardless of `synced`.
    @Test
    fun deletionInLostResponseWindowStillPropagates() {
        val r = SyncReconciler.reconcileServices(
            emptyList(), listOf(Tombstone("inflight", 500L)),
            listOf(svc("inflight", updatedAt = 100, synced = true)),
            meta("inflight" to 100L), 0L, true
        )
        assertEquals(0, r.merged.size)
        assertEquals(listOf("inflight"), r.deletedIds)
    }

    // Frozen Req 11: an absent remote record must NEVER be read as deletions, or a lost
    // server blob would wipe every device.
    @Test
    fun absentRemoteRecordNeverInfersDeletions() {
        val r = SyncReconciler.reconcileServices(
            listOf(
                svc("a", site = "x.com", updatedAt = 100, synced = true),
                svc("b", site = "y.com", updatedAt = 200, synced = true)
            ),
            listOf(Tombstone("c", 50L)), emptyList(), emptyList(), 999L, false
        )
        assertEquals(2, r.merged.size)
        assertEquals(0, r.review.size)
        assertEquals(0, r.tombstones.size)
        assertEquals(0, r.deletedIds.size)
        assertTrue(r.merged.all { !it.synced })
    }

    // A 200 with zero services IS a legitimate delete-all (unlike a 404).
    @Test
    fun emptyRemoteRecordDeletesSyncedLocalRecords() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("a", site = "x.com", updatedAt = 100, synced = true)),
            emptyList(), emptyList(), emptyList(), 500L, true
        )
        assertEquals(0, r.merged.size)
    }

    // Duplicate collapse: the SYNCED loser is tombstoned AND declared so it is removed
    // server-side. Shaped with identical material fields so no SyncConflict is built.
    @Test
    fun duplicateCollapseTombstonesAndDeclaresSyncedLoser() {
        val r = SyncReconciler.reconcileServices(
            emptyList(), emptyList(),
            listOf(
                svc("y1", updatedAt = 100, synced = true),
                svc("y2", updatedAt = 200, synced = true)
            ),
            meta("y1" to 100L, "y2" to 200L), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals("y2", r.merged[0].id)
        assertEquals(listOf("y1"), r.deletedIds)
        assertTrue(r.tombstones.any { it.id == "y1" })
    }

    // An unsynced duplicate loser must NOT be declared (the server never had it).
    @Test
    fun unsyncedDuplicateLoserIsNotDeclared() {
        val r = SyncReconciler.reconcileServices(
            listOf(
                svc("z1", updatedAt = 100, synced = false),
                svc("z2", updatedAt = 200, synced = false)
            ),
            emptyList(), emptyList(), emptyList(), 0L, true
        )
        assertEquals(1, r.merged.size)
        assertEquals(0, r.deletedIds.size)
    }

    // Editing must NOT clear `synced`, or rule 6 becomes unreachable for edited records
    // and deleted services resurrect. Guards the central invariant directly.
    @Test
    fun editedSyncedRecordIsStillSubjectToRemoteDeletion() {
        val r = SyncReconciler.reconcileServices(
            listOf(svc("e", site = "edited.com", updatedAt = 900, synced = true)),
            emptyList(), emptyList(), emptyList(), 1000L, true
        )
        assertEquals(0, r.merged.size)
        assertEquals(0, r.review.size)
    }

    // Empty-normalizing sites fall back to the id as dedup key, so they do not collide.
    @Test
    fun emptyNormalizingSitesUseIdAsDedupKey() {
        val r = SyncReconciler.reconcileServices(
            listOf(
                svc("x1", site = "www.", updatedAt = 100, synced = false),
                svc("x2", site = "https://", updatedAt = 200, synced = false)
            ),
            emptyList(), emptyList(), emptyList(), 0L, true
        )
        assertEquals(2, r.merged.size)
    }

    // Bounded jittered 409 backoff: immediate recursion could burn 8 requests in
    // milliseconds and self-inflict a 429.
    @Test
    fun conflictBackoffIsBoundedAndIncreasing() {
        assertEquals(250L, sm.conflictBackoffMs(0))
        assertEquals(1000L, sm.conflictBackoffMs(1))
        assertEquals(3000L, sm.conflictBackoffMs(2))
        assertFalse(sm.conflictBackoffMs(2) > 5000L)
    }

    // === Frozen Req 1: editing must NOT clear `synced` ===
    // REGRESSION GUARD. The UI builds the replacement ServiceEntry without a synced value
    // (it defaults to false), so an edit path that copies newEntry through silently clears
    // the flag. That turned a later remote deletion into an unsynced local create (rule 4)
    // and RESURRECTED a service the user had deleted on another device.

    @Test
    fun applyEdit_preservesSyncedFromExistingRecord() {
        val existing = svc("a", site = "old.com", updatedAt = 100, synced = true)
        // Mirrors the UI: no synced value supplied, so it defaults to false.
        val fromUi = ServiceEntry(name = "New", site = "new.com", email = "a@b.com")
        val result = ServiceManager.applyEdit(existing, fromUi, "new.com", 500L)
        assertTrue("edit must not clear synced", result.synced)
        assertEquals("a", result.id)
        assertEquals("new.com", result.site)
        assertEquals(500L, result.updatedAt)
    }

    @Test
    fun applyEdit_doesNotInventSyncedForUnsyncedRecord() {
        val existing = svc("a", updatedAt = 100, synced = false)
        val fromUi = ServiceEntry(name = "N", site = "n.com", email = "a@b.com", synced = true)
        val result = ServiceManager.applyEdit(existing, fromUi, "n.com", 500L)
        assertFalse("synced must come from the stored record, not the UI", result.synced)
    }

    // End-to-end form of the resurrection bug: edit locally, then discover the service was
    // deleted remotely. With synced preserved this is a rule 6 deletion retained for
    // review; with synced cleared it would be re-created server-side.
    @Test
    fun editThenRemoteDeletion_doesNotResurrect() {
        val existing = svc("x", updatedAt = 100, synced = true)
        val edited = ServiceManager.applyEdit(
            existing,
            ServiceEntry(name = "X", site = "example.com", email = "a@b.com"),
            "example.com",
            900L
        )
        val r = SyncReconciler.reconcileServices(
            listOf(edited), emptyList(), emptyList(), emptyList(), 500L, true
        )
        assertEquals("must not be re-created server-side", 0, r.merged.size)
        assertEquals(1, r.review.size)
        assertEquals("x", r.review[0].service.id)
    }

    @Test(expected = IllegalArgumentException::class)
    fun canonical_rejectsLongMinValueOutsideSafeIntegerDomain() {
        val nested = JSONObject().put("unsafe", Long.MIN_VALUE)
        val service = ServiceEntry(
            name = "A", site = "a.com", email = "e@x", id = "i1", updatedAt = 1,
            totp = nested
        )
        SyncBlob.canonicalBlobPayload(listOf(service), emptyList(), emptyList(), emptyList())
    }

    // === Frozen Req 9: canonical form drives the no-op PUT skip ===

    @Test
    fun canonical_isOrderIndependentForServices() {
        val a = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true), svc("i2", site = "b.com", updatedAt = 2, synced = true)),
            emptyList(), emptyList(), emptyList()
        )
        val b = SyncBlob.canonicalBlobPayload(
            listOf(svc("i2", site = "b.com", updatedAt = 2, synced = true), svc("i1", updatedAt = 1, synced = true)),
            emptyList(), emptyList(), emptyList()
        )
        assertEquals(a, b)
    }

    @Test
    fun canonical_differsWhenAFieldChanges() {
        val a = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true)), emptyList(), emptyList(), emptyList()
        )
        val b = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true).copy(counter = 2)),
            emptyList(), emptyList(), emptyList()
        )
        assertFalse(a == b)
    }

    // The local-only synced flag must NOT affect the comparison, or every flag flip would
    // force a pointless push.
    @Test
    fun canonical_excludesLocalOnlySyncedFlag() {
        val a = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true)), emptyList(), emptyList(), emptyList()
        )
        val b = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = false)), emptyList(), emptyList(), emptyList()
        )
        assertEquals(a, b)
    }

    // `migrating` IS remote state: the browser extension sets it and syncs it, and it is the only
    // marker for "this site still holds the old password". It was missing from this canonical
    // payload while sync.js included it, so this client was blind to a difference living only in
    // that field and skipped pushes it should have made.
    //
    // The expected string below is pinned CHARACTER FOR CHARACTER against the identical assertion
    // in extension/tests/test.mjs ('canonicalBlobPayload: exact serialization, shared with
    // SyncBlob.kt'). Nothing compares the two platforms mechanically, so if either drifts its own
    // suite fails. Shape: `true` when set, `null` when absent, never `false`.
    @Test
    fun canonical_exactSerializationSharedWithSyncJs() {
        val a = ServiceEntry(
            name = "A", site = "a.com", email = "e@x", length = 20, symbols = "!@", counter = 1,
            id = "i1", updatedAt = 1, migrating = true
        )
        val b = ServiceEntry(
            name = "B", site = "b.com", email = "e@x", length = 20, symbols = "!@", counter = 1,
            id = "i2", updatedAt = 2
        )
        assertEquals(
            "{\"services\":[{\"id\":\"i1\",\"updated_at\":1,\"name\":\"A\",\"site\":\"a.com\"," +
                "\"email\":\"e@x\",\"length\":20,\"symbols\":\"!@\",\"counter\":1," +
                "\"migrating\":true,\"totp\":null,\"ssh\":null}," +
                "{\"id\":\"i2\",\"updated_at\":2,\"name\":\"B\",\"site\":\"b.com\"," +
                "\"email\":\"e@x\",\"length\":20,\"symbols\":\"!@\",\"counter\":1," +
                "\"migrating\":null,\"totp\":null,\"ssh\":null}]," +
                "\"wallets\":[],\"wallet_audit_log\":[],\"sync_conflicts\":[]}",
            SyncBlob.canonicalBlobPayload(listOf(a, b), emptyList(), emptyList(), emptyList())
        )
    }

    @Test
    fun canonical_differsWhenOnlyMigratingDiffers() {
        val a = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true).copy(migrating = true)),
            emptyList(), emptyList(), emptyList()
        )
        val b = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true)), emptyList(), emptyList(), emptyList()
        )
        assertFalse(a == b)
    }

    // The flag must survive being written and read back. This app never sets it, but it is the only
    // shape a service takes here: a field missing from toJsonContent is ERASED FOR EVERY DEVICE on
    // the next push, silently marking a half-finished migration complete and taking the extension's
    // old-password warnings with it.
    @Test
    fun toJsonContent_carriesMigratingBothWays() {
        val flagged = ServiceEntry(name = "A", site = "a.com", email = "e@x", migrating = true)
        assertTrue(flagged.toJsonContent().optBoolean("migrating", false))
        // Omitted rather than written as false, matching the extension, which deletes the property.
        val plain = ServiceEntry(name = "A", site = "a.com", email = "e@x")
        assertFalse(plain.toJsonContent().has("migrating"))
    }

    // The other half of the same bug: the merge builds its records from this parse, so a flag
    // dropped when READING the remote blob is gone from the record that gets written back.
    @Test
    fun parseServicesJson_preservesMigratingFromARemoteBlob() {
        val parsed = ServiceManager.parseServicesJson(
            "{\"services\":[" +
                "{\"name\":\"A\",\"site\":\"a.com\",\"email\":\"e@x\",\"id\":\"i1\",\"updated_at\":1,\"migrating\":true}," +
                "{\"name\":\"B\",\"site\":\"b.com\",\"email\":\"e@x\",\"id\":\"i2\",\"updated_at\":2}]}"
        )
        assertEquals(2, parsed.size)
        assertTrue("a flagged service lost its flag on parse", parsed[0].migrating)
        assertFalse("an unflagged service gained one", parsed[1].migrating)
    }

    // Full round trip, which is what a sync actually does: read the remote blob, then write the
    // merged records back. Either side dropping the field erases it for every device.
    @Test
    fun remoteBlobRoundTripPreservesMigrating() {
        val blob = "{\"services\":[{\"name\":\"A\",\"site\":\"a.com\",\"email\":\"e@x\"," +
            "\"id\":\"i1\",\"updated_at\":1,\"migrating\":true}]}"
        val pushedBack = ServiceManager.parseServicesJson(blob).first().toJsonContent()
        assertTrue(pushedBack.optBoolean("migrating", false))
    }

    @Test
    fun canonical_differsWhenUpdatedAtChanges() {
        val a = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 1, synced = true)), emptyList(), emptyList(), emptyList()
        )
        val b = SyncBlob.canonicalBlobPayload(
            listOf(svc("i1", updatedAt = 2, synced = true)), emptyList(), emptyList(), emptyList()
        )
        assertFalse(a == b)
    }

    // === Cross-platform reconcile oracle ===
    // Drives reconcileServices from the SAME sync-reconcile-vectors.json that the JS suite
    // (extension/tests/test.mjs) consumes. Any JS/Kotlin divergence fails here — this is
    // the mechanical guard that closes the "no cross-platform integration test for sync"
    // drift vector (designs/sync-deletion-reconciliation.md, Test Plan).

    private fun findVectorsFile(): File {
        var dir: File? = File(System.getProperty("user.dir") ?: ".")
        while (dir != null) {
            val f = File(dir, "sync-reconcile-vectors.json")
            if (f.exists()) return f
            dir = dir.parentFile
        }
        throw IllegalStateException(
            "sync-reconcile-vectors.json not found upward from ${System.getProperty("user.dir")}"
        )
    }

    private fun parseServices(arr: JSONArray): List<ServiceEntry> =
        (0 until arr.length()).map { i ->
            val o = arr.getJSONObject(i)
            ServiceEntry(
                name = o.optString("site", "x"),
                site = o.getString("site"),
                email = o.getString("email"),
                updatedAt = o.getLong("updated_at"),
                id = o.getString("id"),
                synced = o.optBoolean("synced", false)
            )
        }

    @Test
    fun crossPlatformReconcileVectors() {
        val root = JSONObject(findVectorsFile().readText())
        val vectors = root.getJSONArray("vectors")
        for (i in 0 until vectors.length()) {
            val v = vectors.getJSONObject(i)
            val name = v.getString("name")
            val local = parseServices(v.getJSONArray("local"))
            val tombstones = (0 until v.getJSONArray("tombstones").length()).map { j ->
                val o = v.getJSONArray("tombstones").getJSONObject(j)
                Tombstone(o.getString("id"), o.getLong("deleted_at"))
            }
            val remoteArr = v.getJSONArray("remote")
            val remote = parseServices(remoteArr)
            val meta: List<Pair<String?, Long>> = (0 until remoteArr.length()).map { j ->
                val o = remoteArr.getJSONObject(j)
                o.getString("id") to o.getLong("updated_at")
            }

            val r = SyncReconciler.reconcileServices(
                local, tombstones, remote, meta,
                v.getLong("lastSuccessfulSyncAt"), v.getBoolean("remoteExists")
            )

            val mergedActual = r.merged.map { "${it.id}|${it.synced}|${it.updatedAt}|${it.site}" }.sorted()
            val deletedActual = r.deletedIds.sorted()
            val reviewActual = r.review.mapNotNull { it.service.id }.sorted()
            val tombActual = r.tombstones.map { it.id }.sorted()
            val resActual = r.resurrected.sorted()

            val exp = v.getJSONObject("expect")
            val mergedArr = exp.getJSONArray("merged")
            val mergedExp = (0 until mergedArr.length()).map { j ->
                val o = mergedArr.getJSONObject(j)
                "${o.getString("id")}|${o.getBoolean("synced")}|${o.getLong("updated_at")}|${o.getString("site")}"
            }.sorted()
            val deletedExp = jsonStrList(exp.getJSONArray("deletedIds")).sorted()
            val reviewExp = jsonStrList(exp.getJSONArray("review")).sorted()
            val tombExp = jsonStrList(exp.getJSONArray("tombstones")).sorted()
            val resExp = jsonStrList(exp.getJSONArray("resurrected")).sorted()

            assertEquals("[$name] merged", mergedExp, mergedActual)
            assertEquals("[$name] deletedIds", deletedExp, deletedActual)
            assertEquals("[$name] review", reviewExp, reviewActual)
            assertEquals("[$name] tombstones", tombExp, tombActual)
            assertEquals("[$name] resurrected", resExp, resActual)
        }
    }

    private fun jsonStrList(arr: JSONArray): List<String> =
        (0 until arr.length()).map { arr.getString(it) }
}
