// Synchronous, offline Public Suffix List classifier for the extension.
// The generated data module MUST be loaded first in every execution context.
(function () {
  const EXPECTED = Object.freeze({
    sourceUrl: "https://publicsuffix.org/list/public_suffix_list.dat",
    version: "2026-05-14_08-35-31_UTC",
    commit: "e452c7058d6946bd76952b128c12f5ce87a5acb8",
    sourceSha256: "6f7f7d9e8c68447f1c74095a12574b7fee46b0cd759c518a659aee0615d8e118",
  });

  const state = {
    status: "unavailable",
    exact: new Set(),
    wildcards: new Set(),
    exceptions: new Set(),
  };

  function normalizeDomainName(value) {
    if (typeof value !== "string" || value === "" || value !== value.trim()) return null;
    if (/\s|\/|@|\?|#|%|\\/.test(value)) return null;
    if (value.includes("://")) return null;
    if (value.includes(":")) return null;
    let ascii;
    try {
      // URL is available in both browser extension contexts and Node's test VM,
      // and gives deterministic WHATWG IDNA processing without a dependency.
      ascii = new URL("http://" + value).hostname.toLowerCase();
    } catch (_) {
      return null;
    }
    if (!ascii || ascii.endsWith(".")) return null;
    const labels = ascii.split(".");
    if (labels.some(label => !label || label.length > 63 || !/^[a-z0-9-]+$/.test(label)
      || label.startsWith("-") || label.endsWith("-"))) return null;
    if (ascii.length > 253) return null;
    return ascii;
  }

  function normalizeRule(rule) {
    if (typeof rule !== "string" || rule === "") return null;
    const marker = rule[0] === "!" || rule.startsWith("*.") ? rule.slice(rule[0] === "!" ? 1 : 2) : rule;
    const normalized = normalizeDomainName(marker);
    return normalized ? normalized : null;
  }

  function initialize() {
    const data = globalThis.KeygrainPublicSuffixData;
    if (!data || data.sourceUrl !== EXPECTED.sourceUrl || data.version !== EXPECTED.version
      || data.commit !== EXPECTED.commit || data.sourceSha256 !== EXPECTED.sourceSha256
      || !Array.isArray(data.rules) || data.rules.length === 0) return;
    const exact = new Set();
    const wildcards = new Set();
    const exceptions = new Set();
    for (const raw of data.rules) {
      if (typeof raw !== "string" || raw !== raw.trim() || raw.includes("#")) return;
      const normalized = normalizeRule(raw);
      if (!normalized) return;
      if (raw.startsWith("!")) exceptions.add(normalized);
      else if (raw.startsWith("*.")) wildcards.add(normalized);
      else exact.add(normalized);
    }
    if (!exact.size) return;
    state.exact = exact;
    state.wildcards = wildcards;
    state.exceptions = exceptions;
    state.status = "ready";
  }

  function isIpv4(value) {
    const parts = value.split(".");
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  }

  function isNumericDotted(value) {
    return /^\d+(?:\.\d+){1,3}$/.test(value);
  }

  function normalizeInput(value) {
    if (typeof value !== "string" || value === "" || value !== value.trim()) return {type: "invalid"};
    if (/\s|\/|@|\?|#|%|\\/.test(value) || value.includes("://")) return {type: "invalid"};

    if (value.startsWith("[") || value.endsWith("]")) {
      if (!/^\[[0-9a-f:.]+\]$/i.test(value) || !value.includes(":")) return {type: "invalid"};
      try { new URL("http://" + value); } catch (_) { return {type: "invalid"}; }
      return {type: "ip", host: value.toLowerCase(), exactOnly: true};
    }
    if (value.includes(":")) return {type: "invalid"};
    if (isNumericDotted(value)) {
      if (!isIpv4(value)) return {type: "invalid"};
      return {type: "ip", host: value, exactOnly: true};
    }

    const host = normalizeDomainName(value);
    if (!host) return {type: "invalid"};
    if (host === "localhost") return {type: "localhost", host, exactOnly: true};
    return {type: "dns", host, exactOnly: false};
  }

  function hasSuffix(labels, suffix) {
    const suffixLabels = suffix.split(".");
    if (labels.length < suffixLabels.length) return false;
    const start = labels.length - suffixLabels.length;
    return suffixLabels.every((label, i) => labels[start + i] === label);
  }

  function findPublicSuffix(host) {
    const labels = host.split(".");
    let exceptionLength = 0;
    for (const exception of state.exceptions) {
      const exceptionLabels = exception.split(".");
      if (hasSuffix(labels, exception) && exceptionLabels.length > exceptionLength) {
        exceptionLength = exceptionLabels.length;
      }
    }
    if (exceptionLength) return {known: true, length: exceptionLength - 1};

    let bestLength = 0;
    for (let length = 1; length <= labels.length; length++) {
      const suffix = labels.slice(labels.length - length).join(".");
      if (state.exact.has(suffix)) bestLength = Math.max(bestLength, length);
      if (length < labels.length && state.wildcards.has(suffix)) bestLength = Math.max(bestLength, length + 1);
    }
    return {known: bestLength > 0, length: bestLength};
  }

  function classify(input) {
    const normalized = normalizeInput(input);
    if (normalized.type === "ip" || normalized.type === "localhost" || normalized.type === "invalid") {
      return normalized.type === "invalid"
        ? {type: "invalid", host: null, exactOnly: false}
        : {...normalized, publicSuffix: null, registrableDomain: null};
    }
    if (state.status !== "ready") return {type: "unavailable", host: null, exactOnly: false};
    const suffix = findPublicSuffix(normalized.host);
    if (!suffix.known) return {type: "unknown-suffix", host: normalized.host, exactOnly: false, publicSuffix: null, registrableDomain: null};
    const labels = normalized.host.split(".");
    const publicSuffix = labels.slice(labels.length - suffix.length).join(".");
    if (labels.length === suffix.length) {
      return {type: "public-suffix", host: normalized.host, exactOnly: false, publicSuffix, registrableDomain: null};
    }
    const registrableDomain = labels.slice(labels.length - suffix.length - 1).join(".");
    return {type: "registrable", host: normalized.host, exactOnly: false, publicSuffix, registrableDomain};
  }

  function isKnownPublicSuffix(host) { return classify(host).type === "public-suffix"; }
  function isKnownRegistrable(host) { return classify(host).type === "registrable"; }
  function isSafeForMatching(host) {
    const result = classify(host);
    return result.type === "registrable" || result.type === "ip" || result.type === "localhost";
  }

  initialize();
  globalThis.KeygrainPublicSuffix = Object.freeze({
    classify,
    isKnownPublicSuffix,
    isKnownRegistrable,
    isSafeForMatching,
    status: () => state.status,
    expected: () => ({...EXPECTED}),
  });
})();
