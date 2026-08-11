package com.secbytech.keygrain.data

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SyncBlobCanonicalInstrumentedTest {
    private fun fixture(): JSONObject {
        val context = InstrumentationRegistry.getInstrumentation().context
        val text = context.assets.open("sync-canonical-vectors.json").bufferedReader().use { it.readText() }
        return JSONObject(text)
    }

    private fun jsonObjectOrNull(obj: JSONObject, key: String): JSONObject? =
        if (obj.has(key) && !obj.isNull(key)) obj.getJSONObject(key) else null

    @Test
    fun canonicalFixtureMatchesProductionAndroidRuntime() {
        val fixture = fixture()
        assertEquals(1, fixture.getInt("schema_version"))
        val cases = fixture.getJSONArray("cases")
        assertTrue(cases.length() > 0)

        for (i in 0 until cases.length()) {
            val testCase = cases.getJSONObject(i)
            val serviceRows = testCase.getJSONArray("services")
            val services = mutableListOf<ServiceEntry>()
            for (j in 0 until serviceRows.length()) {
                val row = serviceRows.getJSONObject(j)
                val metadata = row.getJSONObject("metadata")
                val content = row.getJSONObject("content")
                services += ServiceEntry(
                    name = content.getString("name"),
                    site = content.getString("site"),
                    email = content.getString("email"),
                    length = content.optInt("length", 20),
                    symbols = content.optString("symbols", Keygrain.DEFAULT_SYMBOLS),
                    counter = content.optInt("counter", 1),
                    id = metadata.getString("id"),
                    updatedAt = metadata.getLong("updated_at"),
                    totp = jsonObjectOrNull(content, "totp"),
                    ssh = jsonObjectOrNull(content, "ssh"),
                    migrating = content.optBoolean("migrating", false)
                )
            }

            val walletRows = testCase.getJSONArray("wallets")
            val wallets = (0 until walletRows.length()).map { j ->
                val w = walletRows.getJSONObject(j)
                WalletEntry(
                    walletName = w.getString("wallet_name"),
                    chain = w.getString("chain"),
                    counter = w.getInt("counter"),
                    email = w.getString("email"),
                    mode = w.getString("mode"),
                    createdAt = w.getString("created_at"),
                    updatedAt = w.getString("updated_at"),
                    notes = w.getString("notes")
                )
            }

            val auditRows = testCase.getJSONArray("audit_log")
            val auditLog = (0 until auditRows.length()).map { j ->
                val entry = auditRows.getJSONObject(j)
                WalletAuditEntry(
                    action = entry.getString("action"),
                    walletName = entry.getString("wallet_name"),
                    chain = entry.getString("chain"),
                    counter = entry.getInt("counter"),
                    timestamp = entry.getString("timestamp"),
                    verification = entry.getString("verification")
                )
            }

            val conflictRows = testCase.getJSONArray("sync_conflicts")
            val conflicts = (0 until conflictRows.length()).map { j ->
                SyncConflict.fromJson(conflictRows.getJSONObject(j))
            }

            val actual = SyncBlob.canonicalBlobPayload(services, wallets, auditLog, conflicts)
            assertEquals(testCase.getString("name"), testCase.getString("expected"), actual)
        }
    }
}
