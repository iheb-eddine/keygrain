function canonicalJSON(obj) {
  if (obj === null || typeof obj !== "object") return JSON.stringify(obj);
  if (Array.isArray(obj)) return "[" + obj.map(canonicalJSON).join(",") + "]";
  return "{" + Object.keys(obj).sort().map(k => JSON.stringify(k) + ":" + canonicalJSON(obj[k])).join(",") + "}";
}

async function verifyRulesSignature(json, publicKeyBase64) {
  const payload = canonicalJSON({rules: json.rules, version: json.version});
  const sig = Uint8Array.from(atob(json.signature), c => c.charCodeAt(0));
  const keyBytes = Uint8Array.from(atob(publicKeyBase64), c => c.charCodeAt(0));
  const key = await crypto.subtle.importKey("raw", keyBytes, {name: "Ed25519"}, false, ["verify"]);
  return crypto.subtle.verify("Ed25519", key, sig, new TextEncoder().encode(payload));
}

async function fetchSiteRules(serverUrl, cached, publicKeyBase64) {
  if (cached && Date.now() - cached.fetchedAt < 86400000) {
    return {rules: cached.rules, cacheEntry: null};
  }
  try {
    const resp = await fetch(serverUrl + "/rules.json");
    if (!resp.ok) throw new Error(resp.status);
    const json = await resp.json();
    if (!Array.isArray(json.rules) || !json.version || !json.signature) throw new Error("invalid");
    if (!await verifyRulesSignature(json, publicKeyBase64)) throw new Error("signature verification failed");
    if (cached && json.version <= cached.version) {
      return {rules: cached.rules, cacheEntry: {...cached, fetchedAt: Date.now()}};
    }
    return {rules: json.rules, cacheEntry: {version: json.version, rules: json.rules, fetchedAt: Date.now()}};
  } catch {
    return {rules: cached ? cached.rules : null, cacheEntry: null};
  }
}

function lookupRule(hostname, rules) {
  if (!rules || !hostname) return null;
  const host = hostname.toLowerCase().replace(/^www\./, "");
  for (const rule of rules) {
    if (rule.exact) {
      if (host === rule.domain) return rule;
    } else {
      if (host === rule.domain || host.endsWith("." + rule.domain)) return rule;
    }
  }
  return null;
}
