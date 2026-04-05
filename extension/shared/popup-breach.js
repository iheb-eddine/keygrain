async function fetchBreachFeed(serverUrl, cached) {
  if (cached && Date.now() - cached.fetchedAt < 86400000) {
    return {breaches: cached.breaches, cacheEntry: null};
  }
  try {
    const resp = await fetch(serverUrl + "/breaches.json");
    if (!resp.ok) throw new Error(resp.status);
    const json = await resp.json();
    if (!Array.isArray(json.breaches)) throw new Error("invalid");
    return {breaches: json.breaches, cacheEntry: {version: json.version, breaches: json.breaches, fetchedAt: Date.now()}};
  } catch {
    return {breaches: cached ? cached.breaches : [], cacheEntry: null};
  }
}

function checkBreaches(breaches, services, dismissedIds) {
  return breaches.filter(b => {
    if (dismissedIds.includes(b.id)) return false;
    return services.some(svc => {
      const domain = (svc.site || svc.name).toLowerCase().replace(/^www\./, "");
      return domain === b.domain || domain.endsWith("." + b.domain);
    });
  });
}
