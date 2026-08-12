package com.secbytech.keygrain.data

import org.json.JSONObject

/**
 * A pending deletion (Sync v3). Local-only: tombstones are never sent to the server, and
 * the server stores none. A tombstone lives from the local deletion until a sync confirms
 * the server no longer holds the id (Frozen Req 5) — so there is no unbounded growth and
 * no GC window.
 */
data class Tombstone(val id: String, val deletedAt: Long)

/**
 * A service that was deleted on another device while THIS device held an unsynced change
 * to it (Frozen Req 7). Routine deletions are applied silently and never appear here,
 * which is what keeps this list quiet.
 */
data class DeletionReviewEntry(
    val service: ServiceEntry,
    val deletedAt: Long,
    val seen: Boolean = false
)

data class ServiceEntry(
    val name: String,
    val site: String,
    val email: String,
    val length: Int = 20,
    val symbols: String = Keygrain.DEFAULT_SYMBOLS,
    val counter: Int = 1,
    val id: String? = null,
    val updatedAt: Long = System.currentTimeMillis(),
    val totp: JSONObject? = null,
    val ssh: JSONObject? = null,
    val frecency: Double = 0.0,
    // Sync v3 (the sync v3 reconciliation contract): true iff a record bearing this
    // id has been confirmed present on the server at least once. A property of IDENTITY,
    // not of content — editing MUST NOT clear it, or a remote deletion of an edited
    // record becomes undetectable and the service resurrects. Local-only: never synced.
    val synced: Boolean = false,
    // Set by the browser extension's migration import: this service was brought over from
    // another password manager and the SITE STILL HOLDS THE OLD PASSWORD until the user
    // changes it there. Content, and synced — the extension drives its ⚠ badge, its
    // "Mark as rotated" action and its old-password warnings from this flag.
    //
    // Android has no migration UI and never sets it. It must still be carried through
    // every parse and every write: this class is the only shape a service takes here, so a
    // field missing from toJsonContent is ERASED FOR EVERY DEVICE on the next sync push
    // from this app — silently marking a half-finished migration complete and taking the
    // extension's old-password warnings with it. That was the behaviour until this field
    // existed.
    val migrating: Boolean = false
) {
    /** Serialize all content fields (everything except sync metadata id/updated_at). */
    fun toJsonContent(): JSONObject = JSONObject().apply {
        put("name", name)
        put("site", site)
        put("email", email)
        put("length", length)
        put("symbols", symbols)
        put("counter", counter)
        if (totp != null) put("totp", totp)
        if (ssh != null) put("ssh", ssh)
        if (frecency != 0.0) put("frecency", frecency)
        // Omitted when false, matching the extension, which deletes the property rather
        // than storing `false` (migration-state.js applyMigrating). An explicit `false`
        // would be honest but would change the canonical payload for every service and
        // make this app's first push look like an edit to all of them.
        if (migrating) put("migrating", true)
    }
}
