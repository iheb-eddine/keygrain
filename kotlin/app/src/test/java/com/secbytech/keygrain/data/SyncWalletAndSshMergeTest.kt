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
        val standalone = WalletEntry(id = "w1", walletId = "primary-btc", chain = "universal")
        val legacy = WalletEntry(id = "w2", walletName = "primary-btc", chain = "universal")
        val idOnly = WalletEntry(id = "w3", walletId = "", walletName = "", chain = "")

        assertEquals("primary-btc:universal", WalletEntry.mergeKey(standalone))
        assertEquals("primary-btc:universal", WalletEntry.mergeKey(legacy))
        assertEquals("w3:universal", WalletEntry.mergeKey(idOnly))
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
    fun mergeWalletsPreservesRemoteWhenNotKnown() {
        val remote = listOf(
            WalletEntry(walletId = "vault", chain = "universal", updatedAt = "2026-01-01T00:00:00Z")
        )
        val (merged, newKeys) = SyncMerge.mergeWallets(emptyList(), remote, emptySet())
        assertEquals(1, merged.size)
        assertEquals("vault", merged[0].walletId)
        assertTrue(newKeys.contains("vault:universal"))
    }

    @Test
    fun mergeWalletsDeletesRemoteWhenKnownLocallyDeleted() {
        val remote = listOf(
            WalletEntry(walletId = "vault", chain = "universal", updatedAt = "2026-01-01T00:00:00Z")
        )
        val (merged, newKeys) = SyncMerge.mergeWallets(emptyList(), remote, setOf("vault:universal"))
        assertEquals(0, merged.size)
        assertTrue(newKeys.isEmpty())
    }

    @Test
    fun mergeSshKeysPreservesRemoteWhenNotKnown() {
        val remote = listOf(
            SshKeyEntry(keyName = "deploy-key", updatedAt = 2000L)
        )
        val (merged, newKeys) = SyncMerge.mergeSshKeys(emptyList(), remote, emptySet())
        assertEquals(1, merged.size)
        assertEquals("deploy-key", merged[0].keyName)
        assertTrue(newKeys.contains("deploy-key"))
    }

    @Test
    fun mergeSshKeysDeletesRemoteWhenKnownLocallyDeleted() {
        val remote = listOf(
            SshKeyEntry(keyName = "deploy-key", updatedAt = 2000L)
        )
        val (merged, newKeys) = SyncMerge.mergeSshKeys(emptyList(), remote, setOf("deploy-key"))
        assertEquals(0, merged.size)
        assertTrue(newKeys.isEmpty())
    }
}
