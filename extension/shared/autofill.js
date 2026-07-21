// autofill.js — PURE autofill decision + field-classification helpers.
//
// No top-level DOM / window / chrome access. This file is loaded into four
// environments and must be safe in all of them:
//   - Chrome MV3 service worker   (importScripts in chrome/background.js)
//   - Firefox MV2 background page (manifest background.scripts)
//   - the content isolated world  (executeScript before content.js)
//   - the Node test VM            (buildContext() in tests/test.mjs)
// Helpers are defined at top level AND exposed via globalThis.KeygrainAutofill
// so they resolve regardless of how the file was loaded.
//
// Service descriptor: { email, site, name, frecency?, updated_at?, length?, symbols?, counter? }
// Field descriptor:   { tag, type, name, id, autocomplete, visible, disabled, readOnly, focused, value, key }
//   `key` is an opaque handle produced + consumed ONLY inside content.js
//   (stamped by collectFieldDescriptors, resolved back to an element there).
//   It NEVER crosses the background<->content message boundary.

// Deterministic total order: frecency desc, then updated_at desc, then
// (site + "\n" + email) ascending. Missing frecency/updated_at count as 0.
// Used ONLY to order an ambiguous candidate list — never to pick a fill target.
function rankServices(services) {
  const list = services ? [...services] : [];
  const num = (v) => (Number.isFinite(v) ? v : 0);
  return list.sort((a, b) => {
    const fa = num(a && a.frecency), fb = num(b && b.frecency);
    if (fa !== fb) return fb - fa;
    const ua = num(a && a.updated_at), ub = num(b && b.updated_at);
    if (ua !== ub) return ub - ua;
    const ka = ((a && a.site) || "") + "\n" + ((a && a.email) || "");
    const kb = ((b && b.site) || "") + "\n" + ((b && b.email) || "");
    return ka < kb ? -1 : (ka > kb ? 1 : 0);
  });
}

// Contains '@' at index > 0, a '.' after the '@', and no whitespace.
function looksLikeEmail(v) {
  if (typeof v !== "string") return false;
  if (/\s/.test(v)) return false;
  const at = v.indexOf("@");
  if (at <= 0) return false;
  const dot = v.indexOf(".", at + 1);
  return dot > at;
}

// The ONLY auto-fill outcome is a UNIQUE resolution. Every kind of ambiguity
// (>1 host match with no identity, an identity that matches 0, or an identity
// that matches >1) defers to the popup — we never guess a password.
function selectServiceForFill(matches, context) {
  const list = matches || [];
  if (list.length === 0) return { decision: "none" };
  const raw = context && context.pageEmail;
  const pe = raw ? String(raw).trim().toLowerCase() : null;
  if (pe) {
    const exact = list.filter((m) => ((m && m.email) || "").toLowerCase() === pe);
    if (exact.length === 1) return { decision: "fill", service: exact[0] };
    // 0 matches (identity we don't hold — contradicting) OR >1 (same identity,
    // possibly different counter/length => different passwords): defer.
    return { decision: "ambiguous", candidates: rankServices(exact.length > 1 ? exact : list) };
  }
  if (list.length === 1) return { decision: "fill", service: list[0] };
  return { decision: "ambiguous", candidates: rankServices(list) };
}

// Narrow a service list to only those matching `host` at the MAXIMUM specificity.
// This is what makes "most-specific match wins": on a subdomain login where BOTH
// the registrable domain (example.com) AND the subdomain (app.example.com) are
// saved, the shallower ancestor (example.com) is dropped so the caller sees a
// SINGLE match and auto-fills instead of deferring. A service matches when its
// site ((s.site||s.name).toLowerCase()) equals host OR is a dot-anchored suffix of
// it; specificity is the matched site's label count (site.split(".").length) — a
// longer matching suffix is more specific. Only the services at the single highest
// specificity are returned, in input order. Every matching site is a suffix-or-
// equal of host, and for a given host there is at most ONE suffix per label-count,
// so the top tier is always ONE exact site string; a returned length>1 therefore
// means multiple accounts on that SAME site (a genuine tie), which
// selectServiceForFill then defers on.
//
// SECURITY / MAINTENANCE: the membership test below INTENTIONALLY MIRRORS the
// backgrounds' domainMatches (site===host || host.endsWith("."+site)). The result
// is ALWAYS a SUBSET of that predicate — it can only NARROW the domainMatches set,
// never broaden it. If domainMatches ever changes, this test MUST remain <= it
// (it must never return a service domainMatches would reject); the membership
// pin-tests in tests/test.mjs guard against broadening drift. Returns [] when
// nothing matches; never throws on hostile/missing data (site is String-coerced,
// like the other pure helpers).
function filterMostSpecific(services, host) {
  const list = Array.isArray(services) ? services : [];
  const h = String(host == null ? "" : host).toLowerCase();
  if (h === "") return [];
  const scored = [];
  let best = -1;
  for (const s of list) {
    if (!s) continue;
    const raw = s.site || s.name;
    const site = String(raw == null ? "" : raw).toLowerCase();
    if (site === "") continue;
    if (!(site === h || h.endsWith("." + site))) continue;
    const spec = site.split(".").length;
    scored.push({ s, spec });
    if (spec > best) best = spec;
  }
  return scored.filter((e) => e.spec === best).map((e) => e.s);
}

// A value can be typed into these input types (mirrors the inline path's
// cheapTagTypeGate accepted set, minus "password"). Everything else — checkbox,
// radio, submit, button, file, range, color, date, number, hidden, search,
// url, ... — is a non-enterable control that must NEVER be treated as a
// fillable password/username target, even when its name/id contains
// "pass"/"user" (e.g. PyPI's `type=checkbox id=show-password`).
function isTextEnterableType(type) {
  const t = (type || "").toLowerCase();
  return t === "" || t === "text" || t === "email" || t === "tel";
}

function isPasswordDescriptor(d) {
  if (!d) return false;
  const type = (d.type || "").toLowerCase();
  if (type === "password") return true;
  // Non-enterable controls (checkbox/radio/submit/hidden/...) are never a
  // fillable password field, even if name/id contains "pass". Only text-enterable
  // inputs are classified via the weaker autocomplete/name/id heuristics.
  if (!isTextEnterableType(type)) return false;
  if ((d.autocomplete || "").toLowerCase().indexOf("password") !== -1) return true;
  const name = (d.name || "").toLowerCase();
  const id = (d.id || "").toLowerCase();
  return name.indexOf("pass") !== -1 || id.indexOf("pass") !== -1;
}

// Identity-ish field (may be readonly/hidden — used for READING context, not
// for deciding fillability).
function isUsernameLike(d) {
  if (!d) return false;
  if ((d.type || "").toLowerCase() === "email") return true;
  const ac = (d.autocomplete || "").toLowerCase();
  if (ac === "username" || ac === "email") return true;
  const name = (d.name || "").toLowerCase();
  const id = (d.id || "").toLowerCase();
  return /user|email|login|identifier/.test(name) || /user|email|login|identifier/.test(id);
}

// Fillable username: identity-like, NOT a password, visible+enabled+editable,
// and a text-enterable input type (so a checkbox/radio/etc. named "user" is
// never a fill target).
function isFillableUsernameDescriptor(d) {
  if (!d) return false;
  if (isPasswordDescriptor(d)) return false;
  if (!d.visible || d.disabled || d.readOnly) return false;
  if (!isTextEnterableType((d.type || "").toLowerCase())) return false;
  return isUsernameLike(d);
}

// The page's identity, in priority order; first non-empty wins, else null.
// Result is trimmed + lowercased.
function extractPageEmail(descriptors) {
  const ds = descriptors || [];
  const val = (d) => (d && d.value != null ? String(d.value) : "");
  const norm = (s) => s.trim().toLowerCase();
  // 1. focused identity field with a non-empty value.
  for (const d of ds) {
    if (d && d.focused && isUsernameLike(d) && val(d).trim() !== "") return norm(val(d));
  }
  // 2. visible, enabled, editable identity field with a value.
  for (const d of ds) {
    if (d && d.visible && !d.disabled && !d.readOnly && isUsernameLike(d) && val(d).trim() !== "") return norm(val(d));
  }
  // 3. readonly/disabled identity field with a value (Google's password step).
  for (const d of ds) {
    if (d && (d.readOnly || d.disabled) && isUsernameLike(d) && val(d).trim() !== "") return norm(val(d));
  }
  // 4. type="hidden" identifier input whose value passes looksLikeEmail
  //    (page-controlled — strictest gate).
  for (const d of ds) {
    if (!d || (d.type || "").toLowerCase() !== "hidden") continue;
    const key = ((d.name || "") + " " + (d.id || "") + " " + (d.autocomplete || "")).toLowerCase();
    if (/identifier|email|username|login/.test(key) && looksLikeEmail(val(d).trim())) return norm(val(d));
  }
  return null;
}

// focused password > first visible password > first heuristic password.
function pickPasswordField(descriptors) {
  const ds = descriptors || [];
  for (const d of ds) if (isPasswordDescriptor(d) && d.focused) return d.key;
  for (const d of ds) if (isPasswordDescriptor(d) && d.visible) return d.key;
  for (const d of ds) if (isPasswordDescriptor(d)) return d.key;
  return null;
}

// Fillable username by selector precedence (autocomplete username first).
function pickUsernameField(descriptors) {
  const ds = (descriptors || []).filter(isFillableUsernameDescriptor);
  const byAc = (v) => ds.find((d) => (d.autocomplete || "").toLowerCase() === v);
  const byType = (v) => ds.find((d) => (d.type || "").toLowerCase() === v);
  const byNameId = (re) => ds.find((d) => re.test((d.name || "").toLowerCase()) || re.test((d.id || "").toLowerCase()));
  const pick = byAc("username") || byAc("email") || byType("email")
    || byNameId(/user/) || byNameId(/email/) || byNameId(/login/) || byNameId(/identifier/);
  return pick ? pick.key : null;
}

// ---- OTP one-time-code classification (additive; pure; never throws) ----

// OTP-enterable type gate: text-enterable-for-OTP. ADDS "number" and DROPS "email"
// vs the password path's isTextEnterableType (OTP inputs are frequently type=number,
// which the password path deliberately excludes; email is never an OTP field).
// {text, tel, number, ""}. Internal (not exported), mirroring isTextEnterableType.
function isOtpEnterableType(type) {
  const t = (type || "").toLowerCase();
  return t === "" || t === "text" || t === "tel" || t === "number";
}

// A finite numeric maxlength, else null (absent/hostile). describeField already
// yields int|null; this coerces defensively so a hostile descriptor never throws.
function otpMaxLength(d) {
  const v = d ? d.maxlength : null;
  return (typeof v === "number" && Number.isFinite(v)) ? v : null;
}

// A digit-only pattern: strip a leading '^' and trailing '$', then the remainder is
// [0-9] or \d optionally followed by a quantifier (*, +, ?, {n}, {n,}, {n,m}).
// e.g. [0-9]*, \d*, [0-9]{6}, \d{6,8}. Never throws on non-string/empty input.
function patternIsDigits(p) {
  if (typeof p !== "string" || p === "") return false;
  let s = p;
  if (s.charAt(0) === "^") s = s.slice(1);
  if (s.charAt(s.length - 1) === "$") s = s.slice(0, -1);
  return /^(\[0-9\]|\\d)([*+?]|\{\d+(,\d*)?\})?$/.test(s);
}

// Numeric-shape signal count: (inputmode numeric/decimal) + (maxlength in [6,8]) +
// (digit-only pattern). Internal.
function otpNumericSignals(d) {
  let n = 0;
  const im = ((d && d.inputmode) || "").toString().toLowerCase();
  if (im === "numeric" || im === "decimal") n++;
  const ml = otpMaxLength(d);
  if (ml != null && ml >= 6 && ml <= 8) n++;
  if (patternIsDigits(((d && d.pattern) || "").toString())) n++;
  return n;
}

// One-time-code / OTP field classifier. Ordered rule (Frozen Req 3):
//   1. isOtpEnterableType(type)                              else false
//   2. maxlength present && maxlength < 6                    -> false  (split-box/too-small)
//   3. autocomplete contains "one-time-code"                 -> true   (definitive; BEFORE password reject)
//   4. isPasswordDescriptor(d)                               -> false
//   5. name/id ~ /otp|totp|2fa|mfa|one[-_ ]?time/            -> true   (STRONG)
//   6. name/id ~ /token|auth.?code|verif|security.?code/ && numericSignals>=1 -> true (WEAK+corroborate)
//   7. numericSignals >= 2                                   -> true   (no-name numeric)
//   8. else                                                  -> false
// Step 3 precedes step 4 deliberately so a definitive one-time-code field named
// e.g. "passcode" (which isPasswordDescriptor matches via indexOf("pass")) is not
// wrongly rejected; the type gate already excludes real type=password fields.
// Pure; String-coerces hostile data; NEVER throws.
function isOtpDescriptor(d) {
  if (!d) return false;
  const type = (d.type || "").toString().toLowerCase();
  if (!isOtpEnterableType(type)) return false;                 // 1. type gate
  const ml = otpMaxLength(d);
  if (ml != null && ml < 6) return false;                      // 2. too-small reject
  if ((d.autocomplete || "").toString().toLowerCase().indexOf("one-time-code") !== -1) return true; // 3. definitive
  if (isPasswordDescriptor(d)) return false;                   // 4. password reject
  const name = (d.name || "").toString().toLowerCase();
  const id = (d.id || "").toString().toLowerCase();
  const strong = /otp|totp|2fa|mfa|one[-_ ]?time/;
  if (strong.test(name) || strong.test(id)) return true;       // 5. STRONG name
  const weak = /token|auth.?code|verif|security.?code/;
  if ((weak.test(name) || weak.test(id)) && otpNumericSignals(d) >= 1) return true; // 6. WEAK + corroborate
  if (otpNumericSignals(d) >= 2) return true;                  // 7. no-name numeric
  return false;                                                // 8. else
}

// focused OTP > first visible OTP > first OTP. Returns the opaque `key` or null.
// (Mirrors pickPasswordField; the maxlength<6 reject in isOtpDescriptor means a
//  maxlength=1 split box is never returned.)
function pickOtpField(descriptors) {
  const ds = descriptors || [];
  for (const d of ds) if (isOtpDescriptor(d) && d.focused) return d.key;
  for (const d of ds) if (isOtpDescriptor(d) && d.visible) return d.key;
  for (const d of ds) if (isOtpDescriptor(d)) return d.key;
  return null;
}

// Over-length guard (Frozen Req 10): does a code of length `codeLength` fit a field
// whose maxlength is `maxLength` (int|null; the DOM `.maxLength` property is -1 when
// unset)? Gated on a positive finite numeric maxLength, so an UNSET/absent/hostile
// maxLength (null, -1, NaN, string) NEVER blocks a fill. Complementary to
// isOtpDescriptor step 2 (maxlength<6 => not an OTP field at all): this asks whether
// THIS service's code is too long for THIS OTP field, so it only bites the
// 8-digit-code-into-maxlength-6/7 case. NEVER throws on hostile maxLength.
function otpCodeFitsField(codeLength, maxLength) {
  if (typeof maxLength !== "number" || !Number.isFinite(maxLength) || maxLength <= 0) return true;
  return codeLength <= maxLength;
}

// DOM adapter — pure given an element-like object. `focused` = (el === activeElement).
// Does NOT stamp `key`; content.js's collectFieldDescriptors() does that.
function describeField(el, activeElement) {
  if (!el) return null;
  const attr = (n) => {
    if (typeof el.getAttribute === "function") { const v = el.getAttribute(n); return v == null ? "" : v; }
    return el[n] == null ? "" : el[n];
  };
  return {
    tag: (el.tagName || "").toLowerCase(),
    type: (el.type || "").toLowerCase(),
    name: el.name || "",
    id: el.id || "",
    autocomplete: (attr("autocomplete") || "").toLowerCase(),
    visible: el.offsetParent != null && (el.offsetWidth || 0) > 0,
    disabled: !!el.disabled,
    readOnly: !!el.readOnly,
    focused: el === activeElement,
    value: el.value == null ? "" : el.value,
    inputmode: (attr("inputmode") || "").toLowerCase(),
    maxlength: (() => { const n = parseInt(attr("maxlength"), 10); return Number.isFinite(n) ? n : null; })(),
    pattern: attr("pattern") || "",
  };
}

globalThis.KeygrainAutofill = {
  rankServices,
  selectServiceForFill,
  filterMostSpecific,
  looksLikeEmail,
  isPasswordDescriptor,
  isFillableUsernameDescriptor,
  extractPageEmail,
  pickPasswordField,
  pickUsernameField,
  describeField,
  isOtpDescriptor,
  pickOtpField,
  otpCodeFitsField,
};
