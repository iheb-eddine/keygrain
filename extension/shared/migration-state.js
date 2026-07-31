// === Migration state — pure helpers, shared by the popup and the migrate tab ===
//
// WHY THIS FILE EXISTS
//
// Migration progress used to be described by TWO independent stores:
//
//   services[].migrating          inside the encrypted services blob, SYNCED
//   migrationChecklist[].status   a separate local key, NOT synced
//
// Nothing kept them in agreement, and both directions drifted in practice:
//
//   - Rotating from the popup (Mark as rotated, or bumping the password version)
//     deleted svc.migrating and never touched the checklist, so the menu button
//     went on counting the service as pending forever.
//   - Marking done in the migrate tab wrote the checklist and cleared the flag
//     WITHOUT bumping updated_at, so the sync merge — "newer wins, remote wins
//     ties" (sync.js mergeServices) — restored the flag from the server copy.
//   - Items were matched by (name, email), so renaming or deleting a service in
//     the popup orphaned its item permanently: nothing could ever mark it done.
//
// THE MODEL
//
// services[].migrating is the SINGLE SOURCE OF TRUTH. It is the thing the popup
// badges, the thing the copy/fill warnings read, and the only one of the two that
// reaches other devices. The checklist stores batch MEMBERSHIP only — which
// service ids came out of an import — and every status is DERIVED from the flag
// at render time. A stored status that disagrees with the flag is therefore not
// representable.
//
// All functions here are pure: they take the checklist and the service list and
// return new values. Persistence and crypto live in the callers.
//
// STOPPING A MIGRATION adds a third local store, `migrationStopped` — the ids of services the
// user chose to abandon. It exists because Stop must NOT clear `migrating`: the flag is the only
// warning that a site still holds the old password. See the block above reconcileStopped.

const MIGRATION_CHECKLIST_VERSION = 2;
const MIGRATION_STOPPED_VERSION = 1;

const KeygrainMigration = (function () {
  function lower(s) {
    return (s || "").toLowerCase();
  }

  // Index the live services by id. Services with no id predate the UUID model and
  // cannot be referenced by a checklist item; they are simply not addressable.
  function serviceById(services) {
    const byId = new Map();
    for (const s of services || []) {
      if (s && s.id && !byId.has(s.id)) byId.set(s.id, s);
    }
    return byId;
  }

  // A fresh v2 checklist over the given service ids.
  function newChecklist(ids, createdAt) {
    return {
      version: MIGRATION_CHECKLIST_VERSION,
      createdAt: createdAt,
      items: dedupeIds(ids).map(id => ({id}))
    };
  }

  function dedupeIds(ids) {
    const seen = new Set();
    const out = [];
    for (const id of ids || []) {
      if (!id || seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
    return out;
  }

  // The ids a checklist tracks, in order, ignoring malformed entries. Storage is
  // guarded as defensively as the service list is: a single null item used to throw
  // out of loadChecklist on the init path, which left the page blank rather than
  // showing the error screen.
  function itemIds(checklist) {
    if (!checklist || !Array.isArray(checklist.items)) return [];
    return checklist.items.filter(i => i && i.id).map(i => i.id);
  }

  // Append ids to an existing checklist, skipping ones already tracked. Returns a
  // new checklist; the input is not mutated.
  function addIds(checklist, ids, createdAt) {
    if (!checklist || checklist.version !== MIGRATION_CHECKLIST_VERSION || !Array.isArray(checklist.items)) {
      return newChecklist(ids, createdAt);
    }
    const known = new Set(itemIds(checklist));
    const items = itemIds(checklist).map(id => ({id}));
    for (const id of dedupeIds(ids)) {
      if (!known.has(id)) { known.add(id); items.push({id}); }
    }
    return {version: MIGRATION_CHECKLIST_VERSION, createdAt: checklist.createdAt || createdAt, items};
  }

  // v1 -> v2. v1 items were {name, email, status, doneAt?}; v2 items are {id}.
  //
  // The stored v1 status is DISCARDED, not carried over, and that is deliberate:
  // where v1 said "done" the flag was already cleared, so the derived status
  // agrees; where it said "done" but the flag survived (a rename that defeated
  // the (name, email) match, or a sync tie-break that restored it) the derived
  // status reads "pending" — which is the honest answer, because the popup is
  // still warning the user about that service. The upgrade is self-healing.
  //
  // Items that match no live service are dropped: nothing can ever clear a flag
  // that does not exist, so keeping them would only re-create the stuck counter.
  function upgradeChecklist(checklist, services) {
    const items = [];
    const used = new Set();
    for (const item of (checklist && Array.isArray(checklist.items) ? checklist.items : [])) {
      if (!item) continue;
      const match = (services || []).find(s =>
        s && s.id && !used.has(s.id) &&
        lower(s.name) === lower(item.name) &&
        lower(s.email) === lower(item.email));
      if (match) { used.add(match.id); items.push({id: match.id}); }
    }
    return {
      version: MIGRATION_CHECKLIST_VERSION,
      createdAt: (checklist && checklist.createdAt) || null,
      items
    };
  }

  // Single entry point for readers. Returns the checklist in v2 form plus whether
  // it differs from what was stored, so the caller knows to persist the upgrade.
  // A null/absent checklist stays null — absence means "no migration in progress"
  // and must not be turned into an empty one.
  function normalize(checklist, services) {
    if (!checklist || !Array.isArray(checklist.items)) return {checklist: null, changed: false};
    if (checklist.version === MIGRATION_CHECKLIST_VERSION) return {checklist, changed: false};
    return {checklist: upgradeChecklist(checklist, services), changed: true};
  }

  // Rows for rendering. Status is derived from the flag; name and email come from
  // the SERVICE, so a rename in the popup shows through.
  //
  // PENDING rows are every service carrying `migrating`, whether or not the checklist
  // records it. Membership is a local-only list; the flag is what syncs, so anything
  // that consults membership to decide "is this pending?" under-reports:
  //   - a service renamed before the v1->v2 upgrade ran resolves to no id and is
  //     dropped from membership, yet the popup still badges it and still warns on
  //     copy/fill. Silently under-reporting a security warning is worse than the
  //     over-reporting this whole change set to fix.
  //   - a second device that received an import through sync has the flags but no
  //     checklist at all, so its count would be zero with N badges showing.
  //
  // DONE rows need membership, because a cleared flag is indistinguishable from a
  // service that was never part of a migration. That is all membership is for.
  //
  // Order is stable: members first, in checklist order, then any flagged service the
  // checklist does not know about, in service order.
  //
  // A v1 checklist is upgraded in memory first, so every reader is correct whether or
  // not the stored copy has been rewritten yet.
  //
  // Abandoned services (`stopped`) are excluded outright, member or not: they belong to no
  // batch. Without this, a later import's checklist would list every previously abandoned
  // service alongside its own rows, because the sweep below picks up flagged non-members.
  function project(checklist, services, stopped) {
    const cl = normalize(checklist, services).checklist;
    const stop = new Set(stopped || []);
    const byId = serviceById(services);
    const rows = [];
    const seen = new Set();
    for (const id of itemIds(cl)) {
      const svc = byId.get(id);
      if (!svc || seen.has(svc.id) || stop.has(svc.id)) continue;
      seen.add(svc.id);
      rows.push(row(svc));
    }
    for (const svc of services || []) {
      if (!svc || !svc.id || !svc.migrating || seen.has(svc.id) || stop.has(svc.id)) continue;
      seen.add(svc.id);
      rows.push(row(svc));
    }
    return rows;
  }

  function row(svc) {
    return {
      id: svc.id,
      name: svc.name,
      email: svc.email,
      status: svc.migrating ? "pending" : "done",
      service: svc
    };
  }

  // === Abandoned services — "Stop migration" ===
  //
  // Stop discards the checklist. It MUST NOT clear `migrating`. That flag is the only mark on a
  // service whose site still holds the old password, and it drives four things in the popup: the
  // ⚠ badge, the copy warning, the fill warning, and the Mark as rotated button. The first
  // version of Stop cleared it, which made an abandoned service indistinguishable from a rotated
  // one — so copying its password produced no warning at all and the paste then failed on the
  // site with no explanation. Suppressing that warning while the old password is still live is
  // exactly backwards.
  //
  // The abandoned ids are recorded instead, in the local `migrationStopped` key, and the three
  // functions that read the flags skip them: they are not counted, not projected, and not
  // recorded as membership. All three matter. Without the membership exclusion,
  // ensureMembership would rebuild the checklist out of the very flags Stop left behind; without
  // the projection exclusion, a later import would list them among its own batch.
  //
  // Local-only, exactly like membership. The flag itself still syncs, so a second browser goes on
  // showing these services as pending in its own checklist until it stops them there too.
  // Reconciling that would need a synced per-service state, which means a payload version bump and
  // matching support in the Android client — deliberately not done: the abandoned services are
  // still correctly flagged everywhere, so no device is ever misled about which passwords are old.

  // Tolerant reader for the stored key. Storage can be corrupt or hand-edited, and a malformed
  // value must not throw out of the load path — one null checklist item once left the page blank.
  //
  // The version is CHECKED, not merely recorded: a future format whose `ids` held objects rather
  // than strings would otherwise be read as a list of ids matching no service, which reconcile
  // would silently prune to nothing — quietly un-abandoning every service. An unrecognised
  // version reads as "nothing abandoned", which shows the batch again rather than losing it.
  function storedStoppedIds(stored) {
    if (!stored || stored.version !== MIGRATION_STOPPED_VERSION) return [];
    if (!Array.isArray(stored.ids)) return [];
    return dedupeIds(stored.ids);
  }

  function newStopped(ids) {
    return {version: MIGRATION_STOPPED_VERSION, ids: dedupeIds(ids)};
  }

  // Keep only ids that still name a live, flagged service. A service rotated after being
  // abandoned (Mark as rotated stays available, by design) or deleted drops out, so the key does
  // not grow for the life of the profile — and a service that a later import flags again starts
  // out pending, because a new import is a new decision.
  function reconcileStopped(stopped, services) {
    const flagged = new Set(migratingIds(services));
    const before = dedupeIds(stopped);
    const kept = before.filter(id => flagged.has(id));
    return {ids: kept, changed: kept.length !== before.length};
  }

  // Every service still flagged, INCLUDING abandoned ones. This is the raw flag set: it is what
  // reconcileStopped prunes against. Use pendingIds for "what is the user still working on".
  //
  // The `s.id` requirement keeps the set actionable: a service with no id cannot be addressed by
  // project() or applyMigrating(), so counting it would report work the user has no way to
  // complete. It cannot diverge from the popup's badge, which tests `migrating` alone, because
  // `migrating` is only ever written alongside a freshly generated UUID (the migrate import) and
  // nothing strips ids afterwards.
  function migratingIds(services) {
    return (services || []).filter(s => s && s.id && s.migrating).map(s => s.id);
  }

  // The flagged services the user has not abandoned — the checklist's pending rows, the menu
  // button's count, and the set Stop acts on.
  function pendingIds(services, stopped) {
    const stop = new Set(stopped || []);
    return migratingIds(services).filter(id => !stop.has(id));
  }

  function countPending(services, stopped) {
    return pendingIds(services, stopped).length;
  }

  // Reconcile membership with the flags, in three parts:
  //   - record any flagged service the checklist does not know about
  //   - drop ids whose service is gone, so the key does not grow monotonically across
  //     the life of a profile every time a service is deleted
  //   - materialise a checklist when flags exist but none does (the second-device case)
  //
  // Returns {checklist, changed} so the caller persists only when something moved, and
  // `changed` with a null checklist means "delete the stored key". Absent flags plus an
  // absent checklist stay absent — this never invents an empty checklist. Pruning to
  // empty deletes it, because an all-done batch whose services are gone has nothing
  // left to show.
  //
  // Abandoned services are invisible here. That is what makes Stop stick: it leaves the flags
  // in place on purpose, and without the exclusion this function would immediately rebuild a
  // checklist from them on the next load — Stop would un-do itself.
  function ensureMembership(checklist, services, createdAt, stopped) {
    const norm = normalize(checklist, services);
    const base = norm.checklist;
    const stop = new Set(stopped || []);
    const flagged = pendingIds(services, stopped);
    if (!base && !flagged.length) return {checklist: null, changed: false};

    const live = serviceById(services);
    const kept = itemIds(base).filter(id => live.has(id) && !stop.has(id));
    const next = addIds({version: MIGRATION_CHECKLIST_VERSION, createdAt: base && base.createdAt, items: kept.map(id => ({id}))}, flagged, createdAt);
    if (!next.items.length) return {checklist: null, changed: !!checklist};

    const before = itemIds(base);
    const after = itemIds(next);
    const sameItems = before.length === after.length && before.every((id, i) => id === after[i]);
    // norm.changed matters on its own: a v1 checklist that gains and loses no ids still
    // has to be written back in v2 form, or the upgrade is recomputed on every load.
    return {checklist: next, changed: norm.changed || !sameItems};
  }

  // Apply a flag change to a service list, returning a NEW list. `updated_at` is
  // bumped on every touched service, without which the change loses the sync merge
  // tie-break ("newer wins, remote wins ties" — sync.js reconcileServices) and is
  // silently reverted from the server's still-flagged copy.
  //
  // `synced` is deliberately NOT touched. Per the invariant at the top of
  // reconcileServices, `synced === true` means "a record bearing this id has been
  // confirmed present on the server", a property of IDENTITY rather than content;
  // clearing it on an edit makes rule 6 unreachable and lets a service deleted on
  // another device resurrect. The popup's own rotation path (markRotatedBtn) leaves
  // it alone for the same reason. The updated_at bump alone wins the tie-break, and
  // `migrating` is part of canonicalBlobPayload, so the PUT-skip cannot swallow it.
  //
  // `now` is the timestamp to stamp; callers pass a value strictly greater than every
  // existing updated_at (see nextTimestamp) so ordering stays monotonic.
  function applyMigrating(services, ids, value, now) {
    const target = new Set(ids || []);
    let changed = 0;
    const out = (services || []).map(s => {
      if (!s || !target.has(s.id)) return s;
      const already = !!s.migrating;
      if (already === !!value) return s;
      changed++;
      const next = {...s, updated_at: now};
      if (value) next.migrating = true; else delete next.migrating;
      return next;
    });
    return {services: changed ? out : (services || []), changed};
  }

  return {
    VERSION: MIGRATION_CHECKLIST_VERSION,
    STOPPED_VERSION: MIGRATION_STOPPED_VERSION,
    newChecklist,
    itemIds,
    dedupeIds,
    addIds,
    upgradeChecklist,
    normalize,
    ensureMembership,
    project,
    migratingIds,
    pendingIds,
    countPending,
    storedStoppedIds,
    newStopped,
    reconcileStopped,
    applyMigrating
  };
})();
