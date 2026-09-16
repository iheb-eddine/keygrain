package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class SyncWalletAndSshMergeTest {

    @Test
    fun sshKeyMergeKeyAlignsWithExtensionProtocol() {
        val withEmail = SshKeyEntry(id = "1", keyName = "github", email = "user@example.com")
        val withoutEmail = SshKeyEntry(id = "2", keyName = "github", email = "")
        val uppercaseKey = SshKeyEntry(id = "3", keyName = "GitHub", email = "other@example.com")
        val fallbackId = SshKeyEntry(id = "ssh-custom-id", keyName = "")

        assertEquals("github", SshKeyEntry.mergeKey(withEmail))
        assertEquals("github", SshKeyEntry.mergeKey(withoutEmail))
        assertEquals("github", SshKeyEntry.mergeKey(uppercaseKey))
        assertEquals("ssh-custom-id", SshKeyEntry.mergeKey(fallbackId))
    }

    @Test
    fun walletEntryMergeKeyAlignsWithExtensionProtocol() {
        val standalone = WalletEntry(id = "w1", walletId = "primary-btc")
        val legacy = WalletEntry(id = "w2", walletName = "primary-btc")
        val idOnly = WalletEntry(id = "w3", walletId = "", walletName = "")

        assertEquals("primary-btc", WalletEntry.mergeKey(standalone))
        assertEquals("primary-btc", WalletEntry.mergeKey(legacy))
        assertEquals("w3", WalletEntry.mergeKey(idOnly))
    }

    @Test
    fun sshKeyFromJsonParsesNumericAndIsoTimestamps() {
        val jsonNum = JSONObject().apply {
            put("id", "s1")
            put("key_name", "dev-server")
            put("created_at", 1700000000000L)
            put("updated_at", 1700000005000L)
        }
        val entryNum = SshKeyEntry.fromJson(jsonNum)
        assertEquals(1700000000000L, entryNum.createdAt)
        assertEquals(1700000005000L, entryNum.updatedAt)

        val jsonIso = JSONObject().apply {
            put("id", "s2")
            put("key_name", "prod-server")
            put("created_at", "2024-01-01T00:00:00.000Z")
            put("updated_at", "2024-01-01T12:00:00.000Z")
        }
        val entryIso = SshKeyEntry.fromJson(jsonIso)
        assertEquals(java.time.Instant.parse("2024-01-01T00:00:00.000Z").toEpochMilli(), entryIso.createdAt)
        assertEquals(java.time.Instant.parse("2024-01-01T12:00:00.000Z").toEpochMilli(), entryIso.updatedAt)
    }

    @Test
    fun mergeWalletsPreservesRemoteWhenNoTombstone() {
        val remote = listOf(
            WalletEntry(walletId = "vault", updatedAt = "2026-01-01T00:00:00Z")
        )
        val (merged, tombstones) = SyncMerge.mergeWallets(emptyList(), remote, emptyList())
        assertEquals(1, merged.size)
        assertEquals("vault", merged[0].walletId)
        assertTrue(merged[0].synced)
        assertTrue(tombstones.isEmpty())
    }

    @Test
    fun mergeWalletsDeletesRemoteWhenTombstoneNewer() {
        val remote = listOf(
            WalletEntry(walletId = "vault", updatedAt = "2026-01-01T00:00:00Z")
        )
        val tomb = Tombstone("vault", deletedAt = java.time.Instant.parse("2026-01-02T00:00:00Z").toEpochMilli())
        val (merged, tombstones) = SyncMerge.mergeWallets(emptyList(), remote, listOf(tomb))
        assertEquals(0, merged.size)
        assertEquals(1, tombstones.size)
    }

    @Test
    fun mergeSshKeysPreservesRemoteWhenNoTombstone() {
        val remote = listOf(
            SshKeyEntry(keyName = "deploy-key", updatedAt = 2000L)
        )
        val (merged, tombstones) = SyncMerge.mergeSshKeys(emptyList(), remote, emptyList())
        assertEquals(1, merged.size)
        assertEquals("deploy-key", merged[0].keyName)
        assertTrue(merged[0].synced)
        assertTrue(tombstones.isEmpty())
    }

    @Test
    fun mergeSshKeysDeletesRemoteWhenTombstoneNewer() {
        val remote = listOf(
            SshKeyEntry(keyName = "deploy-key", updatedAt = 2000L)
        )
        val tomb = Tombstone("deploy-key", deletedAt = 3000L)
        val (merged, tombstones) = SyncMerge.mergeSshKeys(emptyList(), remote, listOf(tomb))
        assertEquals(0, merged.size)
        assertEquals(1, tombstones.size)
    }

    @Test
    fun factoryMethodsInitializeSyncedCorrectly() {
        // Local create initializes with synced = false
        val localWallet = WalletEntry(walletId = "my-wallet")
        org.junit.Assert.assertFalse(localWallet.synced)

        val localSsh = SshKeyEntry(keyName = "my-key")
        org.junit.Assert.assertFalse(localSsh.synced)

        // fromJson default initializes with synced = false
        val jsonW = JSONObject().apply { put("wallet_id", "w"); put("updated_at", "2026-01-01T00:00:00Z") }
        val wFromJson = WalletEntry.fromJson(jsonW)
        org.junit.Assert.assertFalse(wFromJson.synced)

        val jsonK = JSONObject().apply { put("key_name", "k"); put("updated_at", 1000L) }
        val kFromJson = SshKeyEntry.fromJson(jsonK)
        org.junit.Assert.assertFalse(kFromJson.synced)

        // fromRemoteJson initializes with synced = true
        val wRemote = WalletEntry.fromRemoteJson(jsonW)
        assertTrue(wRemote.synced)

        val kRemote = SshKeyEntry.fromRemoteJson(jsonK)
        assertTrue(kRemote.synced)
    }

    @Test
    fun zeroResurrectionBugWhenLastSyncAtZero() {
        // Synced wallet absent remotely with remoteExists = true and lastSyncAt = 0
        // MUST be deleted, NOT resurrected!
        val syncedWallet = WalletEntry(id = "w1", walletId = "deleted-vault", synced = true)
        val (mergedW, _) = SyncMerge.mergeWallets(
            local = listOf(syncedWallet),
            remote = emptyList(),
            tombstones = emptyList(),
            lastSyncAt = 0L,
            remoteExists = true
        )
        assertEquals(0, mergedW.size)

        // Synced SSH key absent remotely with remoteExists = true and lastSyncAt = 0
        // MUST be deleted, NOT resurrected!
        val syncedSsh = SshKeyEntry(id = "k1", keyName = "deleted-server", synced = true)
        val (mergedK, _) = SyncMerge.mergeSshKeys(
            local = listOf(syncedSsh),
            remote = emptyList(),
            tombstones = emptyList(),
            lastSyncAt = 0L,
            remoteExists = true
        )
        assertEquals(0, mergedK.size)
    }

    @Test
    fun sshKeyFromJsonFallbackAndEmailExclusion() {
        val legacy = JSONObject().apply {
            put("key_name", "bastion")
            put("email", "legacy@corp.internal")
        }
        val entry = SshKeyEntry.fromJson(legacy)
        assertEquals("legacy@corp.internal", entry.comment)
        assertEquals("", entry.email)

        val serialized = entry.toJson()
        org.junit.Assert.assertFalse(serialized.has("email"))
        assertEquals("legacy@corp.internal", serialized.getString("comment"))
    }
}
