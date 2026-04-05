function fuzzyScore(query, text) {
  const q = query.toLowerCase();
  const t = text.toLowerCase();
  let qi = 0, score = 0, consecutive = 0, prevIdx = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score++;
      if (ti === prevIdx + 1) { consecutive++; score += consecutive; }
      else consecutive = 0;
      if (ti === 0) score += 2;
      if (ti > 0 && /[\s\-_.]/.test(t[ti - 1])) score += 2;
      prevIdx = ti;
      qi++;
    }
  }
  return qi === q.length ? score : 0;
}

function getFilteredServices(services, filter) {
  if (!filter) return services.slice().sort((a, b) => (b.frecency || 0) - (a.frecency || 0));
  return services.map(s => {
    const score = Math.max(fuzzyScore(filter, s.name), fuzzyScore(filter, s.email), fuzzyScore(filter, s.site || ""));
    return {svc: s, score};
  }).filter(x => x.score > 0)
    .sort((a, b) => {
      const sa = a.score * (1 + (a.svc.frecency || 0));
      const sb = b.score * (1 + (b.svc.frecency || 0));
      return sb - sa;
    }).map(x => x.svc);
}
