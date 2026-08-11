package com.secbytech.keygrain.data

/**
 * Selects services whose stored site is the most-specific valid suffix of a visited site.
 *
 * Comparison uses normalized sites, but the returned [ServiceEntry] objects are unchanged so
 * callers continue to use the exact stored site for derivation and credential intents.
 */
object AutofillMatcher {
    fun mostSpecificMatches(
        visitedSite: String,
        services: List<ServiceEntry>,
        psl: PublicSuffixList
    ): List<ServiceEntry> {
        val normalizedVisited = ServiceManager.normalizeSite(visitedSite)
        val visitedRegistrable = psl.extractRegistrableDomain(normalizedVisited) ?: return emptyList()

        val candidates = services.mapNotNull { service ->
            val normalizedCandidate = ServiceManager.normalizeSite(service.site)
            if (normalizedCandidate.isEmpty()) return@mapNotNull null
            if (psl.extractRegistrableDomain(normalizedCandidate) != visitedRegistrable) {
                return@mapNotNull null
            }

            val isExact = normalizedCandidate == normalizedVisited
            val isParent = normalizedVisited.endsWith(".$normalizedCandidate")
            if (isExact || isParent) {
                service to normalizedCandidate
            } else {
                null
            }
        }

        val mostSpecificLabelCount = candidates.maxOfOrNull { (_, candidate) ->
            candidate.split('.').size
        } ?: return emptyList()

        return candidates
            .filter { (_, candidate) -> candidate.split('.').size == mostSpecificLabelCount }
            .map { (service, _) -> service }
    }
}
