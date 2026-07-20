// inline-autofill.js — PURE helpers for the native in-field autofill feature.
//
// No top-level DOM / window / chrome access. Loaded into three environments and
// must be safe in all of them (mirrors autofill.js):
//   - Chrome MV3 service worker   (importScripts in chrome/background.js)
//   - Firefox MV2 background page (manifest background.scripts)
//   - the Node test VM            (buildContext() in tests/test.mjs)
// (In Increment B it is also loaded into the content isolated world.)
// Helpers are exposed via globalThis.KeygrainInline so they resolve regardless
// of how the file was loaded.
//
// Service descriptor: { id, email, site, name, frecency?, updated_at?, length?,
//                       symbols?, counter?, totp?, ssh? }

// A clean, registerable hostname: no scheme/path/userinfo/port/wildcard, no IPv6
// literal, no empty label, and every label is [a-z0-9-] not starting/ending "-".
// Used to VALIDATE-and-DROP a stored site: registration scope must equal the
// runtime domainMatches scope, and one malformed site must never be emitted (a
// single invalid pattern makes chrome.scripting.registerContentScripts reject
// the WHOLE batch — see design CR2).
function isCleanHostname(host) {
  if (typeof host !== "string" || host === "") return false;
  if (/\s/.test(host)) return false;              // whitespace
  if (host.indexOf("://") !== -1) return false;   // scheme
  if (host.indexOf("/") !== -1) return false;     // path
  if (host.indexOf("@") !== -1) return false;     // userinfo
  if (host.indexOf(":") !== -1) return false;     // port (IPv6 also caught below)
  if (host.indexOf("*") !== -1) return false;     // wildcard
  if (host.indexOf("[") !== -1 || host.indexOf("]") !== -1) return false; // IPv6 literal
  const labels = host.split(".");
  for (const label of labels) {
    if (label === "") return false;               // empty label (leading/trailing/double dot)
    if (!/^[a-z0-9-]+$/.test(label)) return false;
    if (label[0] === "-" || label[label.length - 1] === "-") return false;
  }
  return true;
}

// An IPv4 literal (4 dot-separated numeric groups). Used only to suppress the
// nonsensical subdomain wildcard for IP hosts.
function isIPv4(host) {
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(host);
}

// Registration match patterns from the services list. The emitted array is
// ALWAYS fully valid (every element is a well-formed match pattern), so a single
// malformed stored site can NEVER poison the batch (CR2). Per host:
//   host = (service.site || service.name).toLowerCase() — EXACTLY the string the
//   runtime uses (domainMatches((s.site||s.name).toLowerCase(), host)), so
//   registration scope == runtime match scope. Malformed hosts are DROPPED (not
//   salvaged): a port/userinfo/trailing-dot host never matches at runtime either
//   (domainMatches vs portless URL.hostname), so salvaging would register on a
//   host the runtime then refuses to match.
// For a valid host: emit "*://<host>/*" ALWAYS; emit "*://*.<host>/*" ONLY when
// host has >=2 dot-separated labels AND is not an IPv4 literal (blocks bare-TLD
// "*://*.com/*" and a nonsensical IP subdomain wildcard). Dedupe. Sorted output.
function computeMatchPatterns(services) {
  const list = Array.isArray(services) ? services : [];
  const out = new Set();
  for (const s of list) {
    if (!s) continue;
    const raw = s.site || s.name;
    if (typeof raw !== "string") continue;
    const host = raw.toLowerCase();
    if (!isCleanHostname(host)) continue;
    out.add("*://" + host + "/*");
    if (host.split(".").length >= 2 && !isIPv4(host)) {
      out.add("*://*." + host + "/*");
    }
  }
  return Array.from(out).sort();
}

// Icon state, ordered predicate. Never throws on missing keys.
//   !enabled            -> "hidden"
//   !hasLoginField      -> "hidden"
//   !unlocked           -> "locked"
//   hasMatches          -> "active"
//   else                -> "hidden"
function inlineIconState(ctx) {
  const c = ctx || {};
  if (!c.enabled) return "hidden";
  if (!c.hasLoginField) return "hidden";
  if (!c.unlocked) return "locked";
  if (c.hasMatches) return "active";
  return "hidden";
}

// SECURITY-CRITICAL whitelist. Returns ONLY {token, email, name}; any password/
// counter/length/symbols/totp/ssh/frecency/updated_at/site present on the input
// MUST NOT appear on the output. Used by the background before crossing to the
// content world. token = service.id (a plain sync-merge UUID — not secret).
function sanitizeAccountForContent(service) {
  const s = service || {};
  return { token: s.id, email: s.email, name: s.name };
}

// Content-side display model. Input is the already-ranked, already-sanitized
// account list plus the current registrable host; output preserves order.
// primary = email. secondary = name ONLY when it ADDS information: a non-empty
// name whose trimmed, lowercased form differs from BOTH the host and the email.
// On a given site the stored name is usually just the site label (redundant with
// the host) or a copy of the email, so it is dropped; a distinct label (e.g.
// "Work") is kept.
// PURE: no DOM/window/chrome, and — like inlineIconState — it MUST NEVER throw.
// name/email/host are String-coerced before compare so hostile sync data (e.g. a
// numeric or object `name`/`email`) can never raise a TypeError that would wedge
// the icon-click handler and block a fill (a regression). primary keeps the raw
// email value (the DOM renders it via textContent, which coerces for display).
function buildDropdownModel(accounts, host) {
  const list = Array.isArray(accounts) ? accounts : [];
  const hh = String(host == null ? "" : host).toLowerCase();
  return list.map((a) => {
    const x = a || {};
    const name = (x.name == null) ? "" : String(x.name);
    const nn = name.trim().toLowerCase();
    const ee = String(x.email == null ? "" : x.email).toLowerCase();
    const secondary = (name !== "" && nn !== hh && nn !== ee) ? name : "";
    return { token: x.token, primary: x.email, secondary };
  });
}

globalThis.KeygrainInline = {
  computeMatchPatterns,
  inlineIconState,
  sanitizeAccountForContent,
  buildDropdownModel,
};
