package com.secbytech.keygrain.data

import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class PublicSuffixListTest {

    private val testPsl = """
        // Test PSL
        com
        org
        net
        co.uk
        org.uk
        github.io
        herokuapp.com
        blogspot.com
        *.ck
        !www.ck
        *.bd
        de
        io
        app
        jp
        co.jp
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
    fun simpleCom() {
        assertEquals("google.com", PublicSuffixList.extractRegistrableDomain("accounts.google.com"))
    }

    @Test
    fun multiPartTld() {
        assertEquals("example.co.uk", PublicSuffixList.extractRegistrableDomain("foo.example.co.uk"))
    }

    @Test
    fun wildcardTld() {
        assertEquals("foo.bar.ck", PublicSuffixList.extractRegistrableDomain("foo.bar.ck"))
    }

    @Test
    fun wildcardException() {
        assertEquals("www.ck", PublicSuffixList.extractRegistrableDomain("www.ck"))
    }

    @Test
    fun bareTld() {
        assertNull(PublicSuffixList.extractRegistrableDomain("com"))
    }

    @Test
    fun publicSuffixOnly() {
        assertNull(PublicSuffixList.extractRegistrableDomain("co.uk"))
    }

    @Test
    fun ipv4() {
        assertEquals("192.168.1.1", PublicSuffixList.extractRegistrableDomain("192.168.1.1"))
    }

    @Test
    fun ipv6() {
        assertEquals("[::1]", PublicSuffixList.extractRegistrableDomain("[::1]"))
    }

    @Test
    fun localhost() {
        assertEquals("localhost", PublicSuffixList.extractRegistrableDomain("localhost"))
    }

    @Test
    fun withPort() {
        assertEquals("example.com", PublicSuffixList.extractRegistrableDomain("example.com:8443"))
    }

    @Test
    fun unknownTld() {
        assertEquals("bar.internal", PublicSuffixList.extractRegistrableDomain("foo.bar.internal"))
    }

    @Test
    fun githubIoSubdomain() {
        assertEquals("mysite.github.io", PublicSuffixList.extractRegistrableDomain("mysite.github.io"))
    }

    @Test
    fun githubIoDifferentSites() {
        val a = PublicSuffixList.extractRegistrableDomain("foo.github.io")
        val b = PublicSuffixList.extractRegistrableDomain("bar.github.io")
        assertEquals("foo.github.io", a)
        assertEquals("bar.github.io", b)
        assert(a != b) { "Different github.io subdomains must not match" }
    }

    @Test
    fun emptyString() {
        assertNull(PublicSuffixList.extractRegistrableDomain(""))
    }

    @Test
    fun blankString() {
        assertNull(PublicSuffixList.extractRegistrableDomain("   "))
    }

    @Test
    fun singleLabel() {
        assertEquals("intranet", PublicSuffixList.extractRegistrableDomain("intranet"))
    }

    @Test
    fun wwwNotStripped() {
        // www is a regular label, not stripped by PSL
        assertEquals("example.com", PublicSuffixList.extractRegistrableDomain("www.example.com"))
    }

    @Test
    fun deepSubdomain() {
        assertEquals("google.com", PublicSuffixList.extractRegistrableDomain("a.b.c.google.com"))
    }

    @Test
    fun herokuappSubdomain() {
        assertEquals("myapp.herokuapp.com", PublicSuffixList.extractRegistrableDomain("myapp.herokuapp.com"))
    }

    @Test
    fun wildcardBarePublicSuffix() {
        // bar.ck is a public suffix (wildcard *.ck), so it alone is not registrable
        assertNull(PublicSuffixList.extractRegistrableDomain("bar.ck"))
    }

    @Test
    fun registrableDomainDirectly() {
        assertEquals("google.com", PublicSuffixList.extractRegistrableDomain("google.com"))
    }

    @Test
    fun caseInsensitive() {
        assertEquals("google.com", PublicSuffixList.extractRegistrableDomain("Accounts.Google.COM"))
    }
}
