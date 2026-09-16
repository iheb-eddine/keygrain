package com.secbytech.keygrain.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.time.Instant

class SyncMergeTest {

    @Test
    fun remoteWalletPresent_localEmpty_noTombstone_walletPreserved() {
        val remote = listOf(
            WalletEntry(id = "w1", walletId = "primary-btc", updatedAt = "2026-09-10T10:00:00Z")
        )
        val (merged, tombstones) = SyncMerge.mergeWallets(
            local = emptyList(),
            remote = remote,
            tombstones = emptyList()
        )
        assertEquals(1, merged.size)
        assertEquals("primary-btc", merged[0].walletId)
        assertEquals("w1", merged[0].id)
        assertTrue(tombstones.isEmpty())
    }

    @Test
    fun remoteWalletPresent_localEmpty_withTombstone_deletedAtNewer_walletDropped() {
        val remote = listOf(
            WalletEntry(id = "w1", walletId = "savings-eth", updatedAt = "2026-09-10T10:00:00Z")
        )
        val tombstoneTime = Instant.parse("2026-09-10T12:00:00Z").toEpochMilli()
        val tombstones = listOf(Tombstone(id = "savings-eth", deletedAt = tombstoneTime))

        val (merged, remainingTombstones) = SyncMerge.mergeWallets(
            local = emptyList(),
            remote = remote,
            tombstones = tombstones
        )
        assertEquals(0, merged.size)
        assertEquals(1, remainingTombstones.size)
        assertEquals("w1", remainingTombstones[0].id)
        assertEquals(tombstoneTime, remainingTombstones[0].deletedAt)
    }

    @Test
    fun remoteWalletPresent_localEmpty_withTombstone_remoteNewer_walletPreserved() {
        val remote = listOf(
            WalletEntry(id = "w1", walletId = "trading-sol", updatedAt = "2026-09-10T15:00:00Z")
        )
        val tombstoneTime = Instant.parse("2026-09-10T12:00:00Z").toEpochMilli()
        val tombstones = listOf(Tombstone(id = "w1", deletedAt = tombstoneTime))

        val (merged, remainingTombstones) = SyncMerge.mergeWallets(
            local = emptyList(),
            remote = remote,
            tombstones = tombstones
        )
        assertEquals(1, merged.size)
        assertEquals("trading-sol", merged[0].walletId)
        assertEquals(0, remainingTombstones.size) // tombstone dropped because newer remote edit supersedes it
    }

    @Test
    fun localWalletPresent_remoteEmpty_noTombstone_walletPreserved() {
        val local = listOf(
            WalletEntry(id = "w-local", walletId = "cold-storage", updatedAt = "2026-09-10T10:00:00Z")
        )
        val (merged, tombstones) = SyncMerge.mergeWallets(
            local = local,
            remote = emptyList(),
            tombstones = emptyList()
        )
        assertEquals(1, merged.size)
        assertEquals("cold-storage", merged[0].walletId)
        assertTrue(tombstones.isEmpty())
    }

    @Test
    fun bothWalletsPresent_newerUpdatedAtWins() {
        val local = listOf(
            WalletEntry(id = "w1", walletId = "main-wallet", counter = 1, updatedAt = "2026-09-10T08:00:00Z")
        )
        val remote = listOf(
            WalletEntry(id = "w1", walletId = "main-wallet", counter = 2, updatedAt = "2026-09-10T12:00:00Z")
        )
        val (merged, _) = SyncMerge.mergeWallets(local = local, remote = remote, tombstones = emptyList())
        assertEquals(1, merged.size)
        assertEquals(2, merged[0].counter)
    }

    @Test
    fun remoteSshKeyPresent_localEmpty_noTombstone_sshKeyPreserved() {
        val remote = listOf(
            SshKeyEntry(id = "k1", keyName = "staging-server", counter = 1, updatedAt = 1000L)
        )
        val (merged, tombstones) = SyncMerge.mergeSshKeys(
            local = emptyList(),
            remote = remote,
            tombstones = emptyList()
        )
        assertEquals(1, merged.size)
        assertEquals("staging-server", merged[0].keyName)
        assertEquals("k1", merged[0].id)
        assertTrue(tombstones.isEmpty())
    }

    @Test
    fun remoteSshKeyPresent_localEmpty_withTombstone_deletedAtNewer_sshKeyDropped() {
        val remote = listOf(
            SshKeyEntry(id = "k1", keyName = "prod-server", counter = 1, updatedAt = 1000L)
        )
        val tombstones = listOf(Tombstone(id = "prod-server", deletedAt = 2000L))

        val (merged, remainingTombstones) = SyncMerge.mergeSshKeys(
            local = emptyList(),
            remote = remote,
            tombstones = tombstones
        )
        assertEquals(0, merged.size)
        assertEquals(1, remainingTombstones.size)
        assertEquals("k1", remainingTombstones[0].id)
        assertEquals(2000L, remainingTombstones[0].deletedAt)
    }

    @Test
    fun remoteSshKeyPresent_localEmpty_withTombstone_remoteNewer_sshKeyPreserved() {
        val remote = listOf(
            SshKeyEntry(id = "k1", keyName = "backup-server", counter = 2, updatedAt = 3000L)
        )
        val tombstones = listOf(Tombstone(id = "k1", deletedAt = 2000L))

        val (merged, remainingTombstones) = SyncMerge.mergeSshKeys(
            local = emptyList(),
            remote = remote,
            tombstones = tombstones
        )
        assertEquals(1, merged.size)
        assertEquals("backup-server", merged[0].keyName)
        assertEquals(0, remainingTombstones.size)
    }

    @Test
    fun localSshKeyPresent_remoteEmpty_noTombstone_sshKeyPreserved() {
        val local = listOf(
            SshKeyEntry(id = "k-loc", keyName = "bastion", counter = 1, updatedAt = 1500L)
        )
        val (merged, tombstones) = SyncMerge.mergeSshKeys(
            local = local,
            remote = emptyList(),
            tombstones = emptyList()
        )
        assertEquals(1, merged.size)
        assertEquals("bastion", merged[0].keyName)
        assertTrue(tombstones.isEmpty())
    }

    @Test
    fun bothSshKeysPresent_newerUpdatedAtWins() {
        val local = listOf(
            SshKeyEntry(id = "k1", keyName = "router", counter = 1, updatedAt = 5000L)
        )
        val remote = listOf(
            SshKeyEntry(id = "k1", keyName = "router", counter = 2, updatedAt = 4000L)
        )
        val (merged, _) = SyncMerge.mergeSshKeys(local = local, remote = remote, tombstones = emptyList())
        assertEquals(1, merged.size)
        assertEquals(1, merged[0].counter) // local is newer
    }

    @Test
    fun tombstoneMatchingByMergeKey() {
        val remote = listOf(
            WalletEntry(id = "uuid-123", walletId = "vault", updatedAt = "2026-09-10T10:00:00Z")
        )
        val tombstoneTime = Instant.parse("2026-09-10T12:00:00Z").toEpochMilli()
        val tombstones = listOf(Tombstone(id = "vault", deletedAt = tombstoneTime))

        val (merged, remainingTombstones) = SyncMerge.mergeWallets(
            local = emptyList(),
            remote = remote,
            tombstones = tombstones
        )
        assertEquals(0, merged.size)
        assertEquals(1, remainingTombstones.size)
        assertEquals("uuid-123", remainingTombstones[0].id)
    }

    @Test
    fun localWalletPresent_remoteEmpty_lastSyncNewer_walletDeletedRemotely() {
        val local = listOf(
            WalletEntry(id = "w1", walletId = "old-wallet", updatedAt = "2026-09-10T10:00:00Z")
        )
        val lastSyncAt = Instant.parse("2026-09-10T12:00:00Z").toEpochMilli()
        val (merged, _) = SyncMerge.mergeWallets(
            local = local,
            remote = emptyList(),
            tombstones = emptyList(),
            lastSyncAt = lastSyncAt,
            remoteExists = true
        )
        assertEquals(0, merged.size)
    }

    @Test
    fun localWalletPresent_remoteEmpty_localNewer_walletPreserved() {
        val local = listOf(
            WalletEntry(id = "w1", walletId = "new-offline-wallet", updatedAt = "2026-09-10T14:00:00Z")
        )
        val lastSyncAt = Instant.parse("2026-09-10T12:00:00Z").toEpochMilli()
        val (merged, _) = SyncMerge.mergeWallets(
            local = local,
            remote = emptyList(),
            tombstones = emptyList(),
            lastSyncAt = lastSyncAt,
            remoteExists = true
        )
        assertEquals(1, merged.size)
        assertEquals("new-offline-wallet", merged[0].walletId)
    }

    @Test
    fun distinctWallets_tombstoneDoesNotCollide() {
        val remote = listOf(
            WalletEntry(id = "sol-1", walletId = "savings", updatedAt = "2026-09-10T10:00:00Z")
        )
        val tombstoneTime = Instant.parse("2026-09-10T12:00:00Z").toEpochMilli()
        val tombstones = listOf(Tombstone(id = "other-wallet", deletedAt = tombstoneTime))

        val (merged, _) = SyncMerge.mergeWallets(
            local = emptyList(),
            remote = remote,
            tombstones = tombstones
        )
        assertEquals(1, merged.size)
        assertEquals("savings", merged[0].walletId)
    }

    @Test
    fun localSshKeyPresent_remoteEmpty_lastSyncNewer_sshKeyDeletedRemotely() {
        val local = listOf(
            SshKeyEntry(id = "k1", keyName = "old-server", updatedAt = 1000L)
        )
        val (merged, _) = SyncMerge.mergeSshKeys(
            local = local,
            remote = emptyList(),
            tombstones = emptyList(),
            lastSyncAt = 2000L,
            remoteExists = true
        )
        assertEquals(0, merged.size)
    }

    @Test
    fun localSshKeyPresent_remoteEmpty_localNewer_sshKeyPreserved() {
        val local = listOf(
            SshKeyEntry(id = "k1", keyName = "new-offline-server", updatedAt = 3000L)
        )
        val (merged, _) = SyncMerge.mergeSshKeys(
            local = local,
            remote = emptyList(),
            tombstones = emptyList(),
            lastSyncAt = 2000L,
            remoteExists = true
        )
        assertEquals(1, merged.size)
        assertEquals("new-offline-server", merged[0].keyName)
    }

    @Test
    fun walletEditedWalletId_sameUuid_doesNotDuplicate() {
        val remote = listOf(
            WalletEntry(
                id = "b27a0d4a-2b6b-41f5-8b2f-0318b30c2f21",
                walletId = "xxxxx",
                updatedAt = "2026-09-10T10:13:19.552Z"
            )
        )
        val local = listOf(
            WalletEntry(
                id = "b27a0d4a-2b6b-41f5-8b2f-0318b30c2f21",
                walletId = "xxxxxx",
                updatedAt = "2026-09-10T10:17:20.907Z"
            )
        )
        val (merged, _) = SyncMerge.mergeWallets(
            local = local,
            remote = remote,
            tombstones = emptyList()
        )
        assertEquals(1, merged.size)
        assertEquals("xxxxxx", merged[0].walletId)
        assertEquals("b27a0d4a-2b6b-41f5-8b2f-0318b30c2f21", merged[0].id)
    }

    @Test
    fun sshKeyEditedKeyName_sameUuid_doesNotDuplicate() {
        val remote = listOf(
            SshKeyEntry(
                id = "uuid-ssh-1",
                keyName = "dev-server",
                updatedAt = 1000L
            )
        )
        val local = listOf(
            SshKeyEntry(
                id = "uuid-ssh-1",
                keyName = "prod-server",
                updatedAt = 2000L
            )
        )
        val (merged, _) = SyncMerge.mergeSshKeys(
            local = local,
            remote = remote,
            tombstones = emptyList()
        )
        assertEquals(1, merged.size)
        assertEquals("prod-server", merged[0].keyName)
        assertEquals("uuid-ssh-1", merged[0].id)
    }
}
