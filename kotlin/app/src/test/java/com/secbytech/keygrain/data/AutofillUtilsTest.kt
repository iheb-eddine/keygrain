package com.secbytech.keygrain.data

import com.secbytech.keygrain.ui.util.AutofillUtils
import org.junit.Assert.*
import org.junit.Test

class AutofillUtilsTest {

    @Test
    fun testKnownChromePackagesContainsStandardChrome() {
        assertTrue(AutofillUtils.KNOWN_CHROME_PACKAGES.contains("com.android.chrome"))
        assertTrue(AutofillUtils.KNOWN_CHROME_PACKAGES.contains("org.chromium.chrome"))
        assertTrue(AutofillUtils.KNOWN_CHROME_PACKAGES.contains("com.chrome.beta"))
        assertTrue(AutofillUtils.KNOWN_CHROME_PACKAGES.contains("com.chrome.dev"))
        assertTrue(AutofillUtils.KNOWN_CHROME_PACKAGES.contains("com.chrome.canary"))
    }

    @Test
    fun testResolveInstalledChromePackageOrder() {
        val installedPackages = setOf("com.chrome.beta", "com.chrome.dev")
        val found = AutofillUtils.KNOWN_CHROME_PACKAGES.firstOrNull { installedPackages.contains(it) }
        assertEquals("com.chrome.beta", found)
    }

    @Test
    fun testResolveInstalledChromePackageNone() {
        val installedPackages = setOf("org.mozilla.firefox", "com.brave.browser")
        val found = AutofillUtils.KNOWN_CHROME_PACKAGES.firstOrNull { installedPackages.contains(it) }
        assertNull(found)
    }

    @Test
    fun testKnownChromePackagesNotEmpty() {
        assertFalse(AutofillUtils.KNOWN_CHROME_PACKAGES.isEmpty())
    }
}
