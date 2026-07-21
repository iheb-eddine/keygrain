// content.js — thin DOM adapter over the pure KeygrainAutofill.* helpers.
// Injected (after autofill.js) only on an explicit user gesture. Responsibilities:
//   - a SYNCHRONOUS {action:"getFillContext"} snapshot (carries no secret)
//   - fire-and-forget {action:"fill"} / {action:"fillContextMenu"} bounded single fill
// NO auto-submit: only sets values + dispatches input/change.
// Injection guard is intentionally on `window`, NOT globalThis: SET and READ here in the same world => symmetric and correct on Chrome and Firefox. Do NOT "fix" it to globalThis (same rationale as inline-autofill-ui.js): only cross-file helper reads needed globalThis.
if (!window.__keygrain_injected) {
  window.__keygrain_injected = true;

  const FILL_WAIT_MS = 2000;
  let currentFillToken = 0;
  let currentOtpFillToken = 0;
  let lastContextMenuTarget = null;

  document.addEventListener("contextmenu", (e) => {
    lastContextMenuTarget = e.target;
  });

  // Snapshot every <input> as a descriptor, stamping an opaque `key` (index into
  // the parallel `els` array) so a picked descriptor maps back to its element.
  // `key` lives ONLY within a single synchronous collect -> pick -> fill cycle;
  // it never crosses the message boundary.
  function collectFieldDescriptors() {
    const els = Array.from(document.querySelectorAll("input"));
    const active = document.activeElement;
    const descriptors = els.map((el, i) => {
      const d = KeygrainAutofill.describeField(el, active);
      d.key = i;
      return d;
    });
    return { descriptors, els };
  }

  // Native setter bypasses framework-controlled (React/Vue/Angular) inputs.
  // Only sets a value + dispatches input/change — never submits.
  function fillField(field, value) {
    const nativeSet = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set;
    nativeSet.call(field, value);
    field.dispatchEvent(new Event("input", { bubbles: true }));
    field.dispatchEvent(new Event("change", { bubbles: true }));
  }

  // Synchronous; no waiting; NO secret returned to the background.
  function getFillContextSnapshot() {
    const { descriptors } = collectFieldDescriptors();
    return {
      pageEmail: KeygrainAutofill.extractPageEmail(descriptors),
      hasUsernameField: descriptors.some((d) => KeygrainAutofill.isFillableUsernameDescriptor(d)),
      hasPasswordField: descriptors.some((d) => KeygrainAutofill.isPasswordDescriptor(d)),
      hasOtpField: descriptors.some((d) => KeygrainAutofill.isOtpDescriptor(d)),           // autofillOtpForTab settle loop
      focusedIsOtp: (() => {                                                                 // the context-aware shortcut probe (§D3)
        const a = document.activeElement;
        if (!a || a.tagName !== "INPUT") return false;
        return KeygrainAutofill.isOtpDescriptor(KeygrainAutofill.describeField(a, a));
      })(),
    };
  }

  // Bounded single fill. A newer invocation supersedes any prior pending observer
  // via the fill token. Exactly one observer + one FILL_WAIT_MS timer, both
  // deterministically torn down on first fill, supersession, or timeout.
  function performFill(password, email) {
    const token = ++currentFillToken;
    let filled = false;
    let observer = null;
    let timer = null;

    function cleanup() {
      if (observer) { observer.disconnect(); observer = null; }
      if (timer) { clearTimeout(timer); timer = null; }
    }

    // true  = done (filled, superseded, or nothing left to do this call)
    // false = no password field present yet (keep observing within bounds)
    function tryFill() {
      if (token !== currentFillToken) { cleanup(); return true; }
      if (filled) return true;
      const { descriptors, els } = collectFieldDescriptors();
      const pwKey = KeygrainAutofill.pickPasswordField(descriptors);
      const unKey = email ? KeygrainAutofill.pickUsernameField(descriptors) : null;
      const unEl = unKey == null ? null : els[unKey];
      const pwEl = pwKey == null ? null : els[pwKey];
      if (unEl && email) fillField(unEl, email);
      if (pwEl) {
        fillField(pwEl, password);
        filled = true;
        cleanup();
        return true;
      }
      return false;
    }

    if (tryFill()) return;
    // Password field not present yet (multi-step / late render) — observe, bounded.
    observer = new MutationObserver(() => { tryFill(); });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(cleanup, FILL_WAIT_MS);
  }

  // Bounded single OTP fill (mirrors performFill): pick the OTP field, apply the
  // over-length guard, native-set the code + dispatch input/change, NO submit. Uses
  // a SEPARATE otp fill token (performFill's password path is untouched) + one bounded
  // MutationObserver + one FILL_WAIT_MS timer for a late-rendered OTP field (multi-step),
  // all deterministically torn down on fill/supersede/timeout. Returns {filled, reason(, max)}
  // for the popup's honest status (bg/inline callers ignore it; the guard still protects them):
  //   no OTP field yet -> {filled:false, reason:"no_field"} (+ arm observer for a late render)
  //   code too long    -> {filled:false, reason:"field_too_small", max:<maxlength>}
  //   filled           -> {filled:true}
  function performOtpFill(code) {
    const token = ++currentOtpFillToken;
    let observer = null;
    let timer = null;

    function cleanup() {
      if (observer) { observer.disconnect(); observer = null; }
      if (timer) { clearTimeout(timer); timer = null; }
    }

    // Result object when an OTP field is present (filled or too-small); null when no
    // OTP field exists yet (keep observing within bounds).
    function attempt() {
      const c = code == null ? "" : String(code);
      const { descriptors, els } = collectFieldDescriptors();
      const otpKey = KeygrainAutofill.pickOtpField(descriptors);
      if (otpKey == null) return null;
      const otpDesc = descriptors[otpKey];
      if (!KeygrainAutofill.otpCodeFitsField(c.length, otpDesc.maxlength)) {
        return { filled: false, reason: "field_too_small", max: otpDesc.maxlength };
      }
      fillField(els[otpKey], c);
      return { filled: true };
    }

    const first = attempt();
    if (first) return first; // OTP field present (filled or too-small) — no observer needed
    // No OTP field yet (multi-step / late render) — observe, bounded. Fire-and-forget for
    // this late path; the popup already received {filled:false, reason:"no_field"}.
    observer = new MutationObserver(() => {
      if (token !== currentOtpFillToken) { cleanup(); return; } // superseded by a newer call
      if (attempt()) cleanup();                                  // filled or determined too-small — stop
    });
    observer.observe(document.documentElement, { childList: true, subtree: true });
    timer = setTimeout(cleanup, FILL_WAIT_MS);
    return { filled: false, reason: "no_field" };
  }

  // Prefer the last right-clicked target; else fill the resolved password field.
  // Behavior preserved from the prior implementation; only the fallback password
  // lookup now uses the shared picker.
  function fillContextMenu(password, email) {
    const target = lastContextMenuTarget;
    if (target && target.tagName === "INPUT" && target.type === "password") {
      fillField(target, password);
      return;
    }
    if (target && target.tagName === "INPUT" && email) {
      fillField(target, email);
      return;
    }
    const { descriptors, els } = collectFieldDescriptors();
    const pwKey = KeygrainAutofill.pickPasswordField(descriptors);
    if (pwKey != null) fillField(els[pwKey], password);
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === "getFillContext") {
      sendResponse(getFillContextSnapshot());
      return true;
    }
    if (msg.action === "fill") {
      performFill(msg.password, msg.email);
      return; // fire-and-forget
    }
    if (msg.action === "fillOtp") {
      // performOtpFill returns synchronously with the initial-attempt result; the popup
      // awaits it for honest status. bg/inline callers ignore the response.
      sendResponse(performOtpFill(msg.code));
      return true;
    }
    if (msg.action === "fillContextMenu") {
      fillContextMenu(msg.password, msg.email);
      return; // fire-and-forget
    }
  });
}
