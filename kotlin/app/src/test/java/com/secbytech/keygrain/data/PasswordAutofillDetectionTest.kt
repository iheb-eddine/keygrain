package com.secbytech.keygrain.data

import android.text.InputType
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class PasswordAutofillDetectionTest {

    @Test
    fun testPasswordHintsDetection() {
        assertTrue(KeygrainAutofillService.isPasswordHint("password"))
        assertTrue(KeygrainAutofillService.isPasswordHint("current-password"))
        assertTrue(KeygrainAutofillService.isPasswordHint("new-password"))
        assertTrue(KeygrainAutofillService.isPasswordHint("PASSWORD"))
        assertTrue(KeygrainAutofillService.isPasswordHint("Current-Password"))

        assertFalse(KeygrainAutofillService.isPasswordHint("username"))
        assertFalse(KeygrainAutofillService.isPasswordHint("emailAddress"))
        assertFalse(KeygrainAutofillService.isPasswordHint("search"))
    }

    @Test
    fun testPasswordInputTypeDetection() {
        // Standard Android password
        val textPassword = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_PASSWORD
        assertTrue(KeygrainAutofillService.isPasswordInputType(textPassword))

        // Chrome / Web password
        val webPassword = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_PASSWORD
        assertTrue(KeygrainAutofillService.isPasswordInputType(webPassword))

        // Visible password
        val visiblePassword = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_VISIBLE_PASSWORD
        assertTrue(KeygrainAutofillService.isPasswordInputType(visiblePassword))

        // Numeric PIN / password
        val numberPassword = InputType.TYPE_CLASS_NUMBER or InputType.TYPE_NUMBER_VARIATION_PASSWORD
        assertTrue(KeygrainAutofillService.isPasswordInputType(numberPassword))

        // Non-password variations
        val email = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_EMAIL_ADDRESS
        assertFalse(KeygrainAutofillService.isPasswordInputType(email))

        val webEmail = InputType.TYPE_CLASS_TEXT or InputType.TYPE_TEXT_VARIATION_WEB_EMAIL_ADDRESS
        assertFalse(KeygrainAutofillService.isPasswordInputType(webEmail))

        val plainText = InputType.TYPE_CLASS_TEXT
        assertFalse(KeygrainAutofillService.isPasswordInputType(plainText))
    }

    @Test
    fun testPasswordHtmlAttributesDetection() {
        // Standard input type="password" (e.g. GitHub, PyPI)
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "password")))
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "password", "name" to "password", "id" to "password")))

        // HTML autocomplete tokens
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("autocomplete" to "current-password")))
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("autocomplete" to "new-password")))

        // Text input with password names/ids
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "password")))
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "user_passwd")))
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "id" to "pass")))
        assertTrue(KeygrainAutofillService.isPasswordAttributes(mapOf("name" to "password")))

        // Non-enterable controls must NOT match, even if id/name contains "password" (e.g. PyPI checkbox)
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "checkbox", "id" to "show-password")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "button", "id" to "show-password")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "submit", "name" to "password-submit")))

        // Username / email controls must not match
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "username")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "email", "name" to "login")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "id" to "login_field")))

        // False-positive regression guards: words containing "pass" that are NOT passwords
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "passport")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "passport_number")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "passenger_name")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "id" to "compass_heading")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "id" to "bypass_code")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "name" to "boarding_pass")))
        assertFalse(KeygrainAutofillService.isPasswordAttributes(mapOf("type" to "text", "id" to "bus_pass")))
    }
}
