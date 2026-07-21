// inline-autofill-ui.js — Native in-field autofill, Increment B: the VISIBLE UI.
//
// Injected (via the registered content-script js list) ONLY on the user's
// saved-service domains, in the ISOLATED world, after autofill.js +
// inline-autofill.js (so KeygrainAutofill.* and KeygrainInline.* are available)
// and alongside content.js (whose existing {action:"fill"} handler performs the
// actual fill). Self-executing, guarded against re-injection (mirrors content.js).
//
// SECURITY MODEL (see designs/extension-native-infield-autofill.md):
//   - A single body-appended host carries a CLOSED shadow root created with the
//     NATIVE Element.prototype.attachShadow captured at load, in the ISOLATED
//     world — the page can neither read our shadow (closed) nor capture our root
//     (isolated-world prototypes + native ref). world:"MAIN" is FORBIDDEN.
//   - The master secret NEVER enters this world. Only {token,email,name} cross to
//     render; a selection sends {action:"fillInline", token}; the derived password
//     comes back solely via content.js's existing {action:"fill"} path.
//   - Fill/selection/icon activation require event.isTrusted === true AND (for
//     pointer events) a topmost document.elementFromPoint(...) === our host check;
//     keyboard activation is bound to shadow-internal elements only. No auto-fill
//     on programmatic focus; no auto-submit ever.
// Injection guard is intentionally on `window`, NOT globalThis: it is SET and READ here in the same world, so it is symmetric and correct on Chrome and Firefox. Do NOT "fix" it to globalThis — only the cross-file KeygrainAutofill/KeygrainInline reads needed globalThis (Firefox content scripts: this===globalThis!==window).
if (!window.__keygrain_inline_injected) {
  window.__keygrain_inline_injected = true;

  // Capture the NATIVE attachShadow at load: a page that later overrides
  // Element.prototype.attachShadow cannot then capture our closed root. (The
  // isolated world already has its own prototype copies; this is belt-and-braces.)
  const nativeAttachShadow = Element.prototype.attachShadow;

  // Pinned detection ceiling (Decision 6). A SINGLE fixed timer bounds the initial
  // dynamic-render observe window; it is never reset per-mutation.
  const INLINE_OBSERVE_MAX_MS = 8000;
  // S-b: trailing-debounce window for the focusin-driven engage (collapses rapid
  // focus flips into a single background round-trip). 150ms is imperceptible for a
  // legitimate single focus.
  const ENGAGE_DEBOUNCE_MS = 150;
  const Z_TOP = "2147483647";

  // Host style props set with !important so page CSS cannot move or hide us.
  // Deliberately NO transform/filter/contain/will-change: those would make the
  // host a containing block for its fixed-position shadow children and can break
  // the closed-shadow elementFromPoint retargeting the clickjacking gate relies on
  // (review point R2). A 0x0 host never blocks the page; the icon/dropdown are
  // position:fixed and intercept only their own footprint.
  const HOST_STYLE = {
    position: "fixed",
    top: "0px",
    left: "0px",
    width: "0px",
    height: "0px",
    margin: "0px",
    padding: "0px",
    border: "0",
    "z-index": Z_TOP,
  };

  // All visual styling lives INSIDE the shadow. Icon/dropdown rules are appended
  // in later layers; this base keeps internal boxes predictable regardless of
  // page CSS (which cannot reach into the shadow anyway).
  const BASE_CSS = `
:host { all: initial; }
* { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; }
.kg-icon {
  position: fixed; width: 18px; height: 18px; padding: 0; margin: 0; border: 0;
  display: flex; align-items: center; justify-content: center;
  border-radius: 4px; background: #2d6cdf; color: #fff; cursor: pointer;
  box-shadow: 0 1px 3px rgba(0,0,0,.35); line-height: 0;
}
.kg-icon:hover { background: #245bc0; }
.kg-icon:focus-visible { outline: 2px solid #fff; outline-offset: 1px; }
.kg-icon svg { display: block; width: 12px; height: 12px; }
.kg-icon img { display: block; width: 12px; height: 12px; object-fit: contain; }
.kg-dd {
  position: fixed; min-width: 240px; max-width: 340px; max-height: 288px; overflow-y: auto;
  background: #ffffff; color: #1a1a1a; border: 1px solid rgba(0,0,0,.12); border-radius: 10px;
  box-shadow: 0 6px 24px rgba(0,0,0,.18), 0 1px 3px rgba(0,0,0,.10); padding: 6px; outline: none;
  -webkit-font-smoothing: antialiased;
}
.kg-opt {
  display: flex; align-items: center; gap: 10px;
  padding: 8px 10px; border-radius: 8px; cursor: pointer;
  transition: background-color .12s ease;
}
.kg-opt:hover { background: #f1f5fd; }
.kg-opt[aria-selected="true"] { background: #eaf1fd; box-shadow: inset 0 0 0 1px rgba(45,108,223,.35); }
.kg-opt-avatar {
  flex: 0 0 auto; width: 26px; height: 26px; border-radius: 50%;
  display: flex; align-items: center; justify-content: center;
  background: #2d6cdf; color: #fff; font-size: 12px; font-weight: 600; line-height: 1;
  text-transform: uppercase; user-select: none;
}
.kg-opt-text { min-width: 0; flex: 1 1 auto; }
.kg-opt-primary { font-size: 13px; font-weight: 500; color: #1a1a1a; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
.kg-opt-secondary { font-size: 11px; color: #5b6473; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 1px; }
@media (prefers-color-scheme: dark) {
  .kg-dd { background: #1f2430; color: #e6e8ec; border-color: rgba(255,255,255,.12); box-shadow: 0 6px 24px rgba(0,0,0,.5), 0 1px 3px rgba(0,0,0,.4); }
  .kg-opt:hover { background: #2a3140; }
  .kg-opt[aria-selected="true"] { background: #2d3850; box-shadow: inset 0 0 0 1px rgba(120,160,240,.5); }
  .kg-opt-avatar { background: #3b7bea; color: #fff; }
  .kg-opt-primary { color: #e6e8ec; }
  .kg-opt-secondary { color: #9aa3b2; }
}
.kg-hint {
  position: fixed; max-width: 280px; background: #333; color: #fff; font-size: 12px;
  line-height: 1.4; padding: 8px 10px; border-radius: 6px; box-shadow: 0 4px 16px rgba(0,0,0,.25);
}
`;

  // --- element/state refs (populated by later layers; all null-safe here) ---
  let host = null;
  let root = null;
  let iconEl = null;          // the Keygrain icon button (created in the icon layer)
  let dropdownEl = null;      // the account dropdown / locked hint (created later)
  let currentField = null;    // the login field the affordance is anchored to
  let currentAccounts = [];   // redacted {token,email,name}[] for the current host
  let currentKind = "login";  // "login" | "otp" — which bg query + fill action the engaged field uses
  let currentState = "hidden";

  // detection refs (populated by the detection layer)
  let observer = null;
  let observerTimer = null;
  let focusinHandler = null;
  let repositionHandler = null;
  // S-b engage guards: bound background getInlineMatches under a focus-flip storm.
  let engageInFlight = false;     // only ONE getInlineMatches round-trip outstanding at a time
  let pendingEngageField = null;  // latest field requested DURING a round-trip (collapse-not-drop)
  let engageDebounceTimer = null; // ~150ms trailing debounce on the focusin path
  let engageDebounceField = null; // latest focusin field awaiting the debounce

  // dropdown / locked-hint refs (populated by the dropdown layer)
  let ddOptions = [];
  let ddModel = [];
  let activeIndex = -1; // -1 = no-selection sentinel (F1): nothing highlighted -> a stray Enter is a no-op
  let outsideHandler = null;
  let hintTimer = null;
  let pointerArmedEl = null; // F1 1b: element armed by a trusted pointerdown that hit our host (see pointerActivated)

  // --- shadow host lifecycle ---
  // Single body-appended host with a CLOSED shadow root. No page-readable id /
  // class / data-* attributes and no account data on the host element.
  function ensureHost() {
    if (host && document.documentElement && document.documentElement.contains(host)) return;
    host = document.createElement("div");
    // A fresh host means any previous icon/dropdown belonged to a now-discarded
    // root — drop those stale refs so the icon layer rebuilds into the new root
    // (forward item from Unit 1/2 review).
    iconEl = null;
    dropdownEl = null;
    for (const k in HOST_STYLE) host.style.setProperty(k, HOST_STYLE[k], "important");
    root = nativeAttachShadow.call(host, { mode: "closed" });
    const style = document.createElement("style");
    style.textContent = BASE_CSS;
    root.appendChild(style);
    (document.body || document.documentElement).appendChild(host);
  }

  // --- position tracking (wired in the icon layer; null-safe here) ---
  function stopReposition() {
    if (repositionHandler) {
      window.removeEventListener("scroll", repositionHandler, true);
      window.removeEventListener("resize", repositionHandler, true);
      repositionHandler = null;
    }
  }

  // --- dropdown (built in the dropdown layer; null-safe here) ---
  function closeDropdown() {
    if (dropdownEl && dropdownEl.parentNode) dropdownEl.parentNode.removeChild(dropdownEl);
    dropdownEl = null;
    ddOptions = [];
    ddModel = [];
    activeIndex = -1;
    pointerArmedEl = null; // F1 1b: drop any armed pointerdown on close (abandonment reset)
    if (outsideHandler) { document.removeEventListener("pointerdown", outsideHandler, true); outsideHandler = null; }
    if (hintTimer) { clearTimeout(hintTimer); hintTimer = null; }
  }

  // Remove the visible affordance but KEEP detection alive (review point R3): on
  // lock we hide the icon; the next focusin re-queries and shows the locked hint.
  function hideIcon() {
    closeDropdown();
    if (iconEl && iconEl.parentNode) iconEl.parentNode.removeChild(iconEl);
    iconEl = null;
    stopReposition();
    currentField = null;
    currentAccounts = [];
    currentState = "hidden";
  }

  // Detection teardown (populated by the detection layer; null-safe here).
  function stopDetection() {
    if (observer) { observer.disconnect(); observer = null; }
    if (observerTimer) { clearTimeout(observerTimer); observerTimer = null; }
    if (focusinHandler) { document.removeEventListener("focusin", focusinHandler, true); focusinHandler = null; }
    // S-b: cancel any pending debounced/replayed engage so a late timer cannot
    // resurrect the torn-down host after teardown()/disable.
    if (engageDebounceTimer) { clearTimeout(engageDebounceTimer); engageDebounceTimer = null; }
    engageDebounceField = null;
    pendingEngageField = null;
  }

  // Full release on disable (review point R3): the instance becomes fully inert —
  // no host, no observers, no timers, no focusin/scroll/resize/message listeners.
  // On re-enable the background re-registers the content script and a fresh page
  // load re-injects a fresh instance.
  function teardown() {
    hideIcon();
    if (host && host.parentNode) host.parentNode.removeChild(host);
    host = null;
    root = null;
    stopDetection();
    try { chrome.runtime.onMessage.removeListener(onRuntimeMessage); } catch (e) {}
  }

  // --- background bridge -------------------------------------------------------
  // PREFER the promise-based API: browser.runtime.sendMessage(msg) on Firefox (MV2)
  // and chrome.runtime.sendMessage(msg) on Chrome (MV3) both return a promise that
  // resolves with the background listener's returned/sent value. Firefox's inline
  // onMessage listener answers by RETURNING A PROMISE, which the old callback-form
  // sender did not reliably receive (so getInlineMatches came back undefined and the
  // icon never rendered). The callback form is kept ONLY as a last-resort fallback
  // for any runtime that lacks the promise API. A rejected/failed promise resolves to
  // undefined, preserving engage()'s `resp || {}` contract (never an unhandled reject).
  function sendMsg(msg) {
    try {
      const rt = (typeof browser !== "undefined" && browser.runtime && browser.runtime.sendMessage) ? browser.runtime : chrome.runtime;
      const p = rt.sendMessage(msg);
      if (p && typeof p.then === "function") return p.then((r) => r, () => undefined);
    } catch (e) {}
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(msg, (resp) => {
          void chrome.runtime.lastError; // swallow "no receiving end" noise
          resolve(resp);
        });
      } catch (e) {
        resolve(undefined);
      }
    });
  }

  // === Detection (Decision 6) ===================================================
  // Footprint discipline: a cheap tag/type gate runs FIRST; the fuller predicate
  // reuses the already-tested KeygrainAutofill.* helpers; and NO background call /
  // decryption happens until a login field is actually confirmed.

  // Cheap, allocation-free pre-filter for the focusin hot path. Excludes buttons,
  // checkboxes, search boxes, numbers, etc. before any layout read.
  function cheapTagTypeGate(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const t = (el.type || "text").toLowerCase();
    return t === "password" || t === "email" || t === "text" || t === "tel" || t === "";
  }

  // A login field worth an icon: a visible+enabled+editable username-like field,
  // OR a visible+enabled+editable password field. Reuses the tested predicates
  // (isFillableUsernameDescriptor already bundles visible/enabled/editable; the
  // password branch adds the same visibility conjunction, since isPasswordDescriptor
  // ignores visibility). Pure logic delegated to KeygrainAutofill — no duplication.
  function isLoginFieldEl(el) {
    if (!cheapTagTypeGate(el)) return false;
    if (!globalThis.KeygrainAutofill) return false;
    const d = KeygrainAutofill.describeField(el, document.activeElement);
    if (!d) return false;
    if (KeygrainAutofill.isFillableUsernameDescriptor(d)) return true;
    return KeygrainAutofill.isPasswordDescriptor(d) && !!d.visible && !d.disabled && !d.readOnly;
  }

  // Cheap tag/type pre-filter for the OTP path — like cheapTagTypeGate but ADDS "number"
  // (OTP inputs are frequently type=number) and drops password/email (never an OTP field).
  // The login cheapTagTypeGate above is unchanged.
  function cheapOtpTagTypeGate(el) {
    if (!el || el.tagName !== "INPUT") return false;
    const t = (el.type || "text").toLowerCase();
    return t === "text" || t === "tel" || t === "number" || t === "";
  }

  // An OTP field worth an icon: cheap gate first, then the U1-tested pure
  // KeygrainAutofill.isOtpDescriptor over a describeField descriptor. Mirrors isLoginFieldEl;
  // no logic duplication.
  function isOtpFieldEl(el) {
    if (!cheapOtpTagTypeGate(el)) return false;
    if (!globalThis.KeygrainAutofill) return false;
    const d = KeygrainAutofill.describeField(el, document.activeElement);
    if (!d) return false;
    return KeygrainAutofill.isOtpDescriptor(d);
  }

  // Field-classification precedence (§D4). Returns "otp" | "login" | null:
  //   1. a DEFINITIVE one-time-code field (isOtpDescriptor-valid AND autocomplete contains
  //      one-time-code) overrides the login heuristic. (Gating step 1 by isOtpDescriptor —
  //      not a raw attribute check — suppresses the icon on split-box widgets where the fill
  //      would dead-end; see the FLAG-4 decision. Loses no realistic one-time-code positive.)
  //   2. else login (via the existing isLoginFieldEl) — login keeps priority over the OTP heuristic.
  //   3. else the OTP heuristic (isOtpDescriptor).
  //   4. else nothing.
  function classifyEngageField(el) {
    const otp = isOtpFieldEl(el);
    if (otp) {
      const ac = ((el.getAttribute && el.getAttribute("autocomplete")) || "").toLowerCase();
      if (ac.indexOf("one-time-code") !== -1) return "otp";  // step 1: definitive, beats login
    }
    if (isLoginFieldEl(el)) return "login";                  // step 2
    if (otp) return "otp";                                   // step 3: heuristic OTP (after login)
    return null;                                             // step 4
  }

  // First visible engageable field (login OR OTP) in DOM order, or null. Bounded by DOM
  // size; run once on load and on throttled mutations only.
  function findFirstEngageableField() {
    const inputs = document.querySelectorAll("input");
    for (const el of inputs) {
      if (classifyEngageField(el)) return el;
    }
    return null;
  }

  // Render (or re-anchor) the SINGLE icon over the engaged field. Because there is
  // exactly one iconEl, switching from field A to field B just repositions it — no
  // duplicate icon is left behind (forward item from Unit 2 review).
  function showIcon(field, state) {
    ensureHost();                 // may recreate host + null iconEl/dropdownEl
    if (!iconEl) {
      iconEl = buildIcon();
      root.appendChild(iconEl);
    }
    currentField = field;
    currentState = state;
    positionIcon();
    startReposition();
  }

  // Engage a confirmed login field: ONE background round-trip for the redacted
  // {enabled,locked,accounts}; the icon state is decided by the tested pure helper
  // KeygrainInline.inlineIconState. Superseded engages (a newer field) abort.
  async function engage(field) {
    if (!field || field === currentField) return; // already engaged / in flight for this field
    if (!globalThis.KeygrainInline) return;
    const kind = classifyEngageField(field);
    if (!kind) return; // no longer engageable (e.g. field changed between focusin and the debounce)
    // S-b IN-FLIGHT guard: only ONE getInlineMatches round-trip may be outstanding.
    // A re-entrant engage (a focus flip that beat the debounce, or a genuine tab to
    // a new field mid-round-trip) records the LATEST field and returns; it is
    // replayed when the outstanding request settles. This COLLAPSES re-entrant
    // calls to a single background decrypt at a time WITHOUT dropping the icon for
    // a genuinely-focused field.
    if (engageInFlight) { pendingEngageField = field; return; }
    engageInFlight = true;
    currentField = field;
    let resp;
    try {
      resp = await sendMsg({ action: kind === "otp" ? "getInlineOtpMatches" : "getInlineMatches" });
    } finally {
      engageInFlight = false; // reset on EVERY exit path so the icon can never wedge
    }
    if (currentField === field) { // not superseded by a newer engage / not locked away
      const r = resp || {};
      const accounts = Array.isArray(r.accounts) ? r.accounts : [];
      const state = KeygrainInline.inlineIconState({
        enabled: !!r.enabled,
        unlocked: !r.locked,
        hasLoginField: true,
        hasMatches: accounts.length > 0,
      });
      if (state === "hidden") { hideIcon(); }
      else { currentAccounts = accounts; currentKind = kind; currentState = state; showIcon(field, state); }
    }
    // S-b trailing edge: replay the most-recent field requested during the round-trip.
    // Clear pending BEFORE re-invoking so a request arriving during the replay isn't
    // lost; re-enter through the guard above (the field===currentField early-return
    // absorbs a no-op replay with no wasted round-trip).
    if (pendingEngageField) {
      const next = pendingEngageField;
      pendingEngageField = null;
      engage(next);
    }
  }

  // S-b: ~150ms TRAILING debounce for the FOCUSIN path ONLY. Rapid focus flips
  // (a.focus();b.focus()) keep resetting the timer, so a hostile focus loop
  // collapses to ZERO engages while it runs and ONE engage (on the last field)
  // ~150ms after it stops. The initial-scan + MutationObserver paths still call
  // engage() directly (immediate), so page-load icon latency is unchanged and the
  // pure harness (which drives engage via the initial scan and stubs setTimeout)
  // is unaffected.
  function scheduleEngage(field) {
    engageDebounceField = field;
    if (engageDebounceTimer) clearTimeout(engageDebounceTimer);
    engageDebounceTimer = setTimeout(() => {
      engageDebounceTimer = null;
      const f = engageDebounceField;
      engageDebounceField = null;
      if (f) engage(f);
    }, ENGAGE_DEBOUNCE_MS);
  }

  // focusin (capture) — the persistent, cheap ongoing/SPA path.
  function onFocusIn(e) {
    const t = e && e.target;
    if (!classifyEngageField(t)) return; // cheap gates are inside classify; engages a login OR OTP field
    scheduleEngage(t);                   // S-b: debounced (collapses focus-flip storms)
  }

  // Bounded initial dynamic-render observer: a SINGLE fixed 8s timer (never reset
  // per-mutation), throttled callback, deterministic disconnect.
  let observerScheduled = false;
  function startDetection() {
    // 1. one cheap initial synchronous scan for an already-present engageable field
    const initial = findFirstEngageableField();
    if (initial) engage(initial);

    // 2. persistent cheap focusin capture listener
    focusinHandler = onFocusIn;
    document.addEventListener("focusin", focusinHandler, true);

    // 3. bounded MutationObserver for the initial dynamic-render window only
    observer = new MutationObserver(() => {
      if (observerScheduled) return;
      observerScheduled = true;
      requestAnimationFrame(() => {
        observerScheduled = false;
        if (currentField && document.contains(currentField)) return; // still anchored to a live field
        const f = findFirstEngageableField();
        if (f) engage(f);
      });
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    observerTimer = setTimeout(() => {
      if (observer) { observer.disconnect(); observer = null; }
      observerTimer = null;
    }, INLINE_OBSERVE_MAX_MS);
  }

  // === Icon + clickjacking gates (Decision 7 / RH1) ============================
  // Static, constant SVG — no interpolation, so innerHTML here is safe (review
  // point R1: dynamic account text uses textContent, never innerHTML).
  const ICON_SVG = '<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="currentColor" d="M14 2a6 6 0 0 0-5.66 8.03L2 16.37V22h5.63l.9-.9v-2.1h2.1v-2.1h2.1l1.24-1.24A6 6 0 1 0 14 2Zm2.5 5.5a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3Z"/></svg>';
  // The REAL Keygrain logo (shared/icons/icon-48.png, 48x48), inlined as a byte-
  // exact data: URI so NO web_accessible_resources / manifest change is needed.
  // Constant literal (no interpolation) -> R1-safe, like ICON_SVG above. This is
  // the PRIMARY icon; ICON_SVG is the CSP fallback (see buildIcon).
  const ICON_DATA_URI = "data:image/png;base64,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";
  const ICON_SIZE = 18; // MUST match .kg-icon width/height in BASE_CSS
  const ICON_MARGIN = 4;

  function buildIcon() {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "kg-icon";
    btn.setAttribute("aria-label", "Keygrain autofill");
    btn.setAttribute("aria-haspopup", "listbox");
    btn.tabIndex = 0;
    // PRIMARY: the real Keygrain logo as an inlined data: URI <img>. It renders in
    // our closed shadow, but the raster load is still subject to the PAGE's img-src
    // CSP, so strict login sites (e.g. Google) may block it. CSP-ROBUST FALLBACK:
    // on load error, swap in the inline ICON_SVG (DOM markup, NOT a resource load
    // -> immune to img-src CSP) so a clickable icon ALWAYS appears. The error
    // listener uses addEventListener (NOT an inline onerror= attribute, which a
    // page's script-src could block) and is attached BEFORE img.src is set so a
    // synchronously-queued error cannot be missed. Setting btn.innerHTML in the
    // handler replaces only the (dead) img child, never btn's own listeners.
    const img = document.createElement("img");
    img.alt = "";
    img.setAttribute("aria-hidden", "true");
    img.addEventListener("error", () => { btn.innerHTML = ICON_SVG; }); // constant markup only
    img.src = ICON_DATA_URI;
    btn.appendChild(img);
    btn.addEventListener("pointerdown", onPointerArm);       // 1b: arm on a trusted pointerdown that hits our host
    btn.addEventListener("pointercancel", clearPointerArm);  // 1b: abandonment reset
    btn.addEventListener("click", onIconClick);
    btn.addEventListener("keydown", onIconKeydown);
    return btn;
  }

  // Anchor the fixed-position icon to the right edge of the field, clamped to the
  // viewport. Hides the icon when the field leaves the DOM or scrolls out of view.
  function positionIcon() {
    if (!iconEl || !currentField) return;
    if (!document.contains(currentField)) { hideIcon(); return; }
    const rect = currentField.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const offscreen = rect.bottom <= 0 || rect.top >= vh || rect.right <= 0 || rect.left >= vw
      || (rect.width === 0 && rect.height === 0);
    if (offscreen) { iconEl.style.setProperty("display", "none", "important"); return; }
    iconEl.style.setProperty("display", "flex", "important");
    let top = rect.top + (rect.height - ICON_SIZE) / 2;
    let left = rect.right - ICON_SIZE - ICON_MARGIN;
    top = Math.max(0, Math.min(top, vh - ICON_SIZE));
    left = Math.max(0, Math.min(left, vw - ICON_SIZE));
    iconEl.style.setProperty("top", top + "px", "important");
    iconEl.style.setProperty("left", left + "px", "important");
  }

  // Throttled scroll/resize re-anchor; removed by stopReposition() when the icon
  // hides (Unit 1). Also repositions the dropdown when it is open (Unit 4).
  function startReposition() {
    if (repositionHandler) return;
    let scheduled = false;
    repositionHandler = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => {
        scheduled = false;
        positionIcon();
        repositionDropdown();
      });
    };
    window.addEventListener("scroll", repositionHandler, true);
    window.addEventListener("resize", repositionHandler, true);
  }

  // CLICKJACKING GATE — pointer. A fill/selection/activation may proceed only for a
  // genuine user click whose coordinates hit-test to OUR host as the topmost
  // element. document.elementFromPoint retargets a closed-shadow hit to the host,
  // so a transparent page overlay stacked over us returns the overlay (!== host)
  // and is rejected (RH1). Synthetic .click() has isTrusted === false → rejected.
  function trustedPointer(e) {
    if (!e || e.isTrusted !== true) return false;
    return document.elementFromPoint(e.clientX, e.clientY) === host;
  }

  // CLICKJACKING GATE — pointer, part 1b (both endpoints). A pointer activation
  // (icon click, option click) is honored only if BOTH the pointerdown AND the
  // concluding click are trusted and hit OUR host as the topmost element. We arm
  // the element on a passing pointerdown; the click consumes the arm and re-checks
  // trustedPointer. This rejects a paint-over that appears/disappears between the
  // two events, and any activation where either event's topmost isn't our host
  // (pointerdown on the overlay + click on us, or vice-versa -> the same-element
  // check fails). A lingering arm is harmless: the concluding trustedPointer
  // re-check still gates and a synthetic .click() has isTrusted === false.
  //
  // RESIDUAL RISK (OPAQUE pointer-events:none paint-over) — NOW CROSS-BROWSER
  // (Chrome + Firefox parity). An opaque pointer-events:none overlay is invisible
  // to document.elementFromPoint at BOTH events (elementFromPoint skips pe:none),
  // so it passes THIS gate. There is NO reliable alternative to IO-v2 (the
  // browser-computed real-visibility observer) for detecting pe:none occlusion
  // (hit-testing skips such elements), and that observer was CONFIRMED
  // non-functional for our freshly-created dropdown row inside the CLOSED shadow
  // root on Chrome (the browser never reported the row as truly visible, so the
  // former fail-closed gate silently refused ALL selection). Per the adversarial review's
  // pre-agreed contingency the IO v2 gate was REMOVED, so this occlusion residual
  // now applies on Chrome exactly as it always has on Firefox. It is MITIGATED (not
  // eliminated) by layers A + B and the deliberate two-step visible-dropdown
  // interaction: A (activeIndex=-1) kills a single stray Enter/Space; B (trusted
  // pointerdown + concluding click, both topmost-hitting our host) kills pe:auto
  // overlays. A user socially-engineered into a DELIBERATE action on an occluded
  // row (an option CLICK, or a mouse-HOVER/ARROW then ENTER) can still fill — an
  // accepted, documented limitation. The browser toolbar popup and the Ctrl+Shift+K
  // (Cmd+Shift+K on mac) "fill_credentials" command are rendered by browser chrome,
  // cannot be occluded by page content, and remain the UNSPOOFABLE fallback.
  function onPointerArm(e) { pointerArmedEl = trustedPointer(e) ? e.currentTarget : null; }
  function clearPointerArm() { pointerArmedEl = null; }
  function pointerActivated(el, e) {
    const ok = pointerArmedEl === el && trustedPointer(e);
    pointerArmedEl = null; // consume the arm (or clear a mismatch) — one arm per activation
    return ok;
  }

  function onIconClick(e) {
    if (!pointerActivated(e.currentTarget, e)) return; // 1b: pointerdown AND click both hit host
    activateIcon();
  }

  // CLICKJACKING GATE — keyboard. The handler is bound to the icon, a
  // shadow-INTERNAL element (per review point R3 strengthening): the page cannot
  // focus into our closed shadow nor dispatch a trusted keydown here, so isTrusted
  // + focus-containment is sufficient. elementFromPoint is meaningless for keys
  // (clientX/Y are 0), so it is deliberately NOT applied. preventDefault suppresses
  // the browser's synthesized click (which would carry coords 0,0).
  function onIconKeydown(e) {
    if (e.key !== "Enter" && e.key !== " " && e.key !== "Spacebar") return;
    e.preventDefault();
    if (e.isTrusted !== true) return;
    activateIcon();
  }

  function activateIcon() {
    if (currentState === "active") toggleDropdown();
    else if (currentState === "locked") showLockedHint();
  }

  // === Dropdown + locked hint + fill (Unit 4) ==================================

  // Toggle the account dropdown (only meaningful in the "active" state).
  function toggleDropdown() {
    if (dropdownEl) { closeDropdown(); return; }
    if (currentState !== "active" || !globalThis.KeygrainInline) return;
    // The content script knows the current registrable host; pass it so the pure
    // model can drop a secondary line that merely repeats the site (or the email).
    const host = (location.hostname || "").replace(/^www\./, "").toLowerCase();
    const model = KeygrainInline.buildDropdownModel(currentAccounts, host);
    if (!model.length) return;
    openDropdown(model);
  }

  // Build the listbox. Account text (email/name) is set via textContent ONLY —
  // never innerHTML — so a synced/imported service name like
  // '<img src=x onerror=...>' renders as inert text and cannot execute in our
  // isolated-world shadow (review point R1). The token is captured in the option's
  // click closure; it is NEVER written to a DOM attribute.
  function openDropdown(model) {
    ddModel = model;
    ddOptions = [];
    // Open with NO option pre-highlighted (F1 clickjacking fix): activeIndex = -1
    // is the no-selection sentinel, so an occluded, focused dropdown + one stray
    // Enter fills NOTHING. Deliberate selection (Arrow keys then Enter, or a click)
    // is required. dd.focus() below is KEPT so listbox a11y is preserved.
    activeIndex = -1;

    const dd = document.createElement("div");
    dd.className = "kg-dd";
    dd.setAttribute("role", "listbox");
    dd.setAttribute("aria-label", "Keygrain accounts");
    dd.tabIndex = -1;

    model.forEach((m, i) => {
      const opt = document.createElement("div");
      opt.className = "kg-opt";
      opt.id = "kg-opt-" + i; // id lives inside the closed shadow (not page-readable)
      opt.setAttribute("role", "option");
      opt.setAttribute("aria-selected", "false");

      // Leading circular avatar: the email's first character, uppercased. DECORATIVE
      // (aria-hidden) so the option's announced text stays "email [secondary]"
      // exactly as before. Set via textContent ONLY (R1) — never innerHTML — and
      // null-safe (C2): an empty/undefined email yields "?" instead of throwing on
      // charAt/toUpperCase.
      const avatar = document.createElement("div");
      avatar.className = "kg-opt-avatar";
      avatar.setAttribute("aria-hidden", "true");
      // C5: primary is the RAW email (buildDropdownModel does NOT coerce primary,
      // only the comparison), so String-coerce here before .trim() — a hostile/
      // corrupt non-string email (e.g. a number) must NOT throw and wedge the fill
      // path (same class as C1). null-safe (C2): empty email yields "?".
      const em = (m.primary == null) ? "" : String(m.primary);
      const ch = em.trim().charAt(0);
      avatar.textContent = ch ? ch.toUpperCase() : "?"; // textContent (R1), no-throw (C2/C5)
      opt.appendChild(avatar);

      // Text column. min-width:0 in CSS lets the single-line ellipsis work inside
      // the flex row. primary = email; secondary rendered ONLY when non-empty.
      const text = document.createElement("div");
      text.className = "kg-opt-text";
      const primary = document.createElement("div");
      primary.className = "kg-opt-primary";
      primary.textContent = m.primary || ""; // email — textContent (R1)
      text.appendChild(primary);
      if (m.secondary) {
        const secondary = document.createElement("div");
        secondary.className = "kg-opt-secondary";
        secondary.textContent = m.secondary; // name — textContent (R1)
        text.appendChild(secondary);
      }
      opt.appendChild(text);

      const token = m.token;
      opt.addEventListener("pointerdown", onPointerArm);       // 1b: arm on a trusted pointerdown that hits our host
      opt.addEventListener("pointercancel", clearPointerArm);  // 1b: abandonment reset
      opt.addEventListener("click", (e) => {
        if (!pointerActivated(e.currentTarget, e)) return;     // 1b: pointerdown AND click both hit host
        selectToken(token);
      });
      opt.addEventListener("mousemove", () => setActive(i));
      dd.appendChild(opt);
      ddOptions.push(opt);
    });

    dd.addEventListener("keydown", onDropdownKeydown);
    dropdownEl = dd;
    root.appendChild(dd);
    positionDropdown();
    updateActive();

    // Dismiss on a pointerdown outside our host (does not fire for the opening
    // click, which already dispatched before this listener was added).
    outsideHandler = (e) => {
      if (document.elementFromPoint(e.clientX, e.clientY) !== host) closeDropdown();
    };
    document.addEventListener("pointerdown", outsideHandler, true);

    dd.focus();
  }

  function setActive(i) {
    if (i < 0 || i >= ddOptions.length) return;
    activeIndex = i;
    updateActive();
  }

  function updateActive() {
    for (let i = 0; i < ddOptions.length; i++) {
      ddOptions[i].setAttribute("aria-selected", i === activeIndex ? "true" : "false");
    }
    if (dropdownEl && ddOptions[activeIndex]) {
      dropdownEl.setAttribute("aria-activedescendant", ddOptions[activeIndex].id);
      const el = ddOptions[activeIndex];
      if (el.scrollIntoView) el.scrollIntoView({ block: "nearest" });
    }
  }

  // Keyboard nav + focus trap, bound to the shadow-internal listbox (review point
  // R3 strengthening). Tab is trapped (moves the active option, never leaves).
  function onDropdownKeydown(e) {
    const n = ddOptions.length;
    if (!n) return;
    if (e.key === "ArrowDown") {
      // From the -1 no-selection sentinel, ArrowDown moves to the first option.
      e.preventDefault(); setActive(activeIndex < 0 ? 0 : Math.min(n - 1, activeIndex + 1));
    } else if (e.key === "ArrowUp") {
      // From the -1 no-selection sentinel, ArrowUp moves to the last option (ARIA-conventional).
      e.preventDefault(); setActive(activeIndex < 0 ? n - 1 : Math.max(0, activeIndex - 1));
    } else if (e.key === "Home") {
      e.preventDefault(); setActive(0);
    } else if (e.key === "End") {
      e.preventDefault(); setActive(n - 1);
    } else if (e.key === "Tab") {
      e.preventDefault(); // focus trap
      setActive(e.shiftKey ? Math.max(0, activeIndex - 1) : Math.min(n - 1, activeIndex + 1));
    } else if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
      e.preventDefault();
      if (e.isTrusted !== true) return; // keyboard gate: trusted + in our closed shadow
      // No-selection sentinel guard (F1): activeIndex < 0 means nothing is
      // highlighted, so a (possibly occluded) stray Enter/Space fills NOTHING.
      // ddModel[-1] === undefined, but we make the guard explicit and robust.
      const m = activeIndex >= 0 ? ddModel[activeIndex] : null;
      if (!m) return;
      selectToken(m.token);
    } else if (e.key === "Escape") {
      e.preventDefault();
      closeDropdown();
      if (iconEl && iconEl.focus) iconEl.focus(); // return focus to the affordance
    }
  }

  // The ONLY thing that crosses to the background is {action:"fillInline"|"fillInlineOtp", token},
  // branched on the engaged field's kind. The secret never enters this world; the derived
  // password/code returns solely via content.js's existing {action:"fill"} / {action:"fillOtp"}
  // handler. No auto-submit.
  function selectToken(token) {
    closeDropdown();
    if (currentField && currentField.focus) { try { currentField.focus(); } catch (e) {} }
    sendMsg({ action: currentKind === "otp" ? "fillInlineOtp" : "fillInline", token }); // fire-and-forget
  }

  // Non-blocking locked affordance (review point R5): verbatim design copy, NEVER a
  // secret/PIN input, NEVER chrome.action.openPopup, never blocks the page. Toggles
  // off on re-activation, dismisses on outside click, and auto-dismisses.
  function showLockedHint() {
    if (dropdownEl) { closeDropdown(); return; }
    const hint = document.createElement("div");
    hint.className = "kg-hint";
    hint.setAttribute("role", "status");
    hint.textContent = "Keygrain is locked — click the Keygrain icon in your browser toolbar to unlock.";
    dropdownEl = hint;
    root.appendChild(hint);
    positionDropdown();
    outsideHandler = (e) => {
      if (document.elementFromPoint(e.clientX, e.clientY) !== host) closeDropdown();
    };
    document.addEventListener("pointerdown", outsideHandler, true);
    hintTimer = setTimeout(closeDropdown, 6000);
  }

  // Position the dropdown/hint under the field, flipping above when there is no
  // room below; clamped to the viewport.
  function repositionDropdown() {
    positionDropdown();
  }
  function positionDropdown() {
    if (!dropdownEl || !currentField) return;
    if (!document.contains(currentField)) { closeDropdown(); return; }
    const rect = currentField.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const box = dropdownEl.getBoundingClientRect();
    const w = box.width || 220;
    const h = box.height || 0;
    let left = rect.left;
    let top = rect.bottom + 2;
    if (top + h > vh && rect.top - h - 2 >= 0) top = rect.top - h - 2; // flip up
    left = Math.max(0, Math.min(left, vw - w));
    top = Math.max(0, Math.min(top, Math.max(0, vh - h)));
    dropdownEl.style.setProperty("left", left + "px", "important");
    dropdownEl.style.setProperty("top", top + "px", "important");
  }

  // --- background broadcasts (review point R4) ---
  // Handles ONLY the two inline broadcast actions and returns undefined for
  // everything else, so content.js's {action:"fill"} / {action:"getFillContext"}
  // sendResponse is undisturbed (both listeners coexist in the one isolated world).
  function onRuntimeMessage(msg) {
    if (!msg) return;
    if (msg.action === "inlineLockChanged" && msg.locked) { hideIcon(); return; }
    if (msg.action === "inlineDisabled") { teardown(); return; }
    // not ours — leave for content.js; do NOT sendResponse, do NOT return true
  }
  chrome.runtime.onMessage.addListener(onRuntimeMessage);

  // Entry point: begin bounded detection. No icon renders and no background call
  // happens unless/until a login field is confirmed on this saved-service page.
  startDetection();
}
