package com.secbytech.keygrain.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test

class AutofillMatcherTest {
    private val testPsl = """
        com
        org
        net
        github.io
    """.trimIndent()

    @Before
    fun setUp() {
        PublicSuffixList.initFromString(testPsl)
    }

    @After
    fun tearDown() {
        PublicSuffixList.reset()
    }

    @Test
    fun exactMatchWins() {
        val exact = service("accounts.google.com", "exact")
        val parent = service("google.com", "parent")

        val matches = match("accounts.google.com", parent, exact)

        assertEquals(listOf("exact"), matches.map { it.name })
    }

    @Test
    fun parentFallbackMatchesSubdomain() {
        val parent = service("google.com", "parent")

        val matches = match("login.accounts.google.com", parent)

        assertEquals(listOf("parent"), matches.map { it.name })
    }

    @Test
    fun defaultTrustedBrowsersContainOnlyVerifiedPackages() {
        assertEquals(
            setOf(
                "com.android.chrome",
                "org.mozilla.firefox",
                "com.sec.android.app.sbrowser",
                "com.brave.browser",
                "com.microsoft.emmx",
                "com.duckduckgo.mobile.android",
                "com.opera.browser"
            ),
            KeygrainAutofillService.DEFAULT_BROWSER_PACKAGES
        )
    }

    @Test
    fun mostSpecificParentBeatsBroaderParent() {
        val broad = service("google.com", "broad")
        val specific = service("accounts.google.com", "specific")

        val matches = match("login.accounts.google.com", broad, specific)

        assertEquals(listOf("specific"), matches.map { it.name })
    }

    @Test
    fun suffixRequiresDotBoundary() {
        val google = service("google.com", "google")

        val matches = match("evilgoogle.com", google)

        assertEquals(emptyList<ServiceEntry>(), matches)
    }

    @Test
    fun registrableDomainKeepsGithubIoSitesSeparate() {
        val github = service("foo.github.io", "foo")

        val matches = match("bar.github.io", github)

        assertEquals(emptyList<ServiceEntry>(), matches)
    }

    @Test
    fun equalSpecificityTiesRemainAvailable() {
        val first = service("accounts.google.com", "first")
        val second = service("accounts.google.com", "second")
        val broad = service("google.com", "broad")

        val matches = match("login.accounts.google.com", first, broad, second)

        assertEquals(listOf("first", "second"), matches.map { it.name })
    }

    private fun match(visited: String, vararg services: ServiceEntry): List<ServiceEntry> =
        AutofillMatcher.mostSpecificMatches(visited, services.toList(), PublicSuffixList)

    private fun service(site: String, name: String) = ServiceEntry(
        name = name,
        site = site,
        email = "$name@example.com"
    )
}
