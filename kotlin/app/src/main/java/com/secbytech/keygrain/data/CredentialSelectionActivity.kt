package com.secbytech.keygrain.data

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.credentials.GetCredentialResponse
import androidx.credentials.PasswordCredential
import androidx.credentials.exceptions.GetCredentialUnknownException
import androidx.credentials.provider.PendingIntentHandler

class CredentialSelectionActivity : ComponentActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)

        val email = intent.getStringExtra("email")
        val site = intent.getStringExtra("site")
        val length = intent.getIntExtra("length", 20)
        val symbols = intent.getStringExtra("symbols") ?: "!@#$%&*-_=+?"
        val counter = intent.getIntExtra("counter", 1)

        if (email == null || site == null) {
            fail()
            return
        }

        val secret = SecretManager(applicationContext).getSecret()
        if (secret == null) {
            fail()
            return
        }

        val password = try {
            Keygrain.derivePassword(
                secret = secret.toByteArray(),
                email = email,
                site = site,
                length = length,
                symbols = symbols,
                counter = counter
            )
        } catch (_: Exception) {
            fail()
            return
        }

        val credential = PasswordCredential(email, password)
        val result = Intent()
        PendingIntentHandler.setGetCredentialResponse(
            result, GetCredentialResponse(credential)
        )
        setResult(RESULT_OK, result)
        finish()
    }

    private fun fail() {
        val result = Intent()
        PendingIntentHandler.setGetCredentialException(
            result, GetCredentialUnknownException()
        )
        setResult(RESULT_CANCELED, result)
        finish()
    }
}
