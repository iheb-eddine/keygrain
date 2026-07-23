package com.secbytech.keygrain.data

import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File
import java.util.Base64

/**
 * Independent cross-platform check of the sync auth derivations against the
 * SHARED fixture keygrain/sync-vectors.json.
 *
 * This is a GENUINE independent check (not a regression pin): Kotlin runs REAL
 * Argon2id (BouncyCastle) and did NOT generate the fixture — the fixture was
 * produced by the extension JS oracle (ci/gen-sync-vectors.mjs). If Kotlin's
 * deriveLookupId / deriveAuthPassword / deriveEncryptionKey drift from the pinned
 * values, or the mobile AES-GCM decrypt diverges, this test fails.
 *
 * The fixture is READ from disk (no hardcoded values) — this also closes the
 * documented "Kotlin hardcoded vectors" drift vector for the sync path.
 */
class SyncEngineTest {

    private fun bytesToHex(bytes: ByteArray): String =
        bytes.joinToString("") { "%02x".format(it) }

    /**
     * Resolve keygrain/sync-vectors.json. Mirrors the existing KeygrainTest
     * File("../../vectors.json") convention (gradle test working dir = the
     * app module dir, so ../.. is the repo root). Falls back to an upward
     * search that ONLY accepts a directory which also contains vectors.json,
     * so it can never silently resolve to an unrelated sync-vectors.json.
     */
    private fun fixtureFile(): File {
        val primary = File("../../sync-vectors.json")
        if (primary.exists()) return primary
        var dir: File? = File(".").absoluteFile
        while (dir != null) {
            val candidate = File(dir, "sync-vectors.json")
            if (candidate.exists() && File(dir, "vectors.json").exists()) return candidate
            dir = dir.parentFile
        }
        throw IllegalStateException(
            "sync-vectors.json not found (searched from ${File(".").absolutePath})"
        )
    }

    private fun fixture(): JSONObject = JSONObject(fixtureFile().readText())

    private fun secretBytes(f: JSONObject): ByteArray =
        f.getString("secret").toByteArray(Charsets.UTF_8)

    @Test
    fun testLookupIdMatchesFixture() {
        val f = fixture()
        Keygrain.clearStrengthenCache()
        val result = Keygrain.deriveLookupId(secretBytes(f), f.getString("email"))
        assertEquals(f.getString("lookup_id"), result)
    }

    @Test
    fun testAuthPasswordMatchesFixture() {
        val f = fixture()
        Keygrain.clearStrengthenCache()
        val result = Keygrain.deriveAuthPassword(secretBytes(f), f.getString("email"))
        assertEquals(f.getString("auth_password"), result)
    }

    @Test
    fun testEncryptionKeyMatchesFixture() {
        val f = fixture()
        Keygrain.clearStrengthenCache()
        val result = Keygrain.deriveEncryptionKey(secretBytes(f), f.getString("email"))
        assertEquals(f.getString("encryption_key_hex"), bytesToHex(result))
    }

    /**
     * End-to-end: decrypt the pinned blob with the mobile AES-GCM path
     * (SyncCrypto.decrypt, AAD = lookup_id) and assert the recovered password
     * services derive to the pinned expected values via the REAL Keygrain code.
     */
    @Test
    fun testDecryptBlobAndDerivePasswords() {
        val f = fixture()
        val secret = secretBytes(f)
        val email = f.getString("email")

        Keygrain.clearStrengthenCache()
        val encKey = Keygrain.deriveEncryptionKey(secret, email)
        val lookupId = Keygrain.deriveLookupId(secret, email)
        val aad = lookupId.toByteArray(Charsets.UTF_8)

        val blob = Base64.getDecoder().decode(
            f.getJSONObject("server_response").getString("encrypted_blob")
        )
        val plaintext = SyncCrypto.decrypt(encKey, blob, aad)
        val content = JSONObject(String(plaintext, Charsets.UTF_8))
        val decrypted = content.getJSONArray("services")

        // Index decrypted services by (site,email) so shared-site entries
        // (alice/bob on shared.example) don't collide.
        val bySiteEmail = HashMap<String, JSONObject>()
        for (i in 0 until decrypted.length()) {
            val s = decrypted.getJSONObject(i)
            bySiteEmail["${s.getString("site")}\n${s.getString("email")}"] = s
        }

        val services = f.getJSONArray("services")
        var passwordChecks = 0
        for (i in 0 until services.length()) {
            val svc = services.getJSONObject(i)
            val expected = svc.optJSONObject("expected") ?: continue
            if (!expected.has("password")) continue

            val site = svc.getString("site")
            val svcEmail = svc.getString("email")
            // Confirm the service survived the decrypt round-trip.
            assertTrue(
                "decrypted blob missing $site/$svcEmail",
                bySiteEmail.containsKey("$site\n$svcEmail")
            )

            Keygrain.clearStrengthenCache()
            val pw = Keygrain.derivePassword(
                secret = secret,
                email = svcEmail,
                site = site,
                length = svc.getInt("length"),
                symbols = svc.getString("symbols"),
                counter = svc.getInt("counter")
            )
            assertEquals(
                "password mismatch for $site/$svcEmail",
                expected.getString("password"),
                pw
            )
            passwordChecks++
        }
        // Fixture is expected to exercise multiple password services (incl. the
        // shared-site --service-email disambiguation). Guard against a fixture
        // that silently loses them.
        assertTrue("expected >=2 password services, got $passwordChecks", passwordChecks >= 2)
    }
}
