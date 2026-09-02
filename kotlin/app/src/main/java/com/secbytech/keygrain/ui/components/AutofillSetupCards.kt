package com.secbytech.keygrain.ui.components

import android.content.Context
import android.content.Intent
import android.provider.Settings
import android.widget.Toast
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CheckCircle
import androidx.compose.material.icons.filled.OpenInNew
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.secbytech.keygrain.ui.util.AutofillUtils

@Composable
fun AutofillSetupBanner(
    isAutofillEnabled: Boolean,
    onEnableAutofill: () -> Unit,
    modifier: Modifier = Modifier
) {
    if (isAutofillEnabled) return

    Card(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 16.dp, vertical = 6.dp),
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = MaterialTheme.colorScheme.primaryContainer
        )
    ) {
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(12.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            Icon(
                Icons.Default.Settings,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.onPrimaryContainer,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(12.dp))
            Column(modifier = Modifier.weight(1f)) {
                Text(
                    text = "Enable Autofill",
                    style = MaterialTheme.typography.titleSmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
                Text(
                    text = "Set Keygrain as your default autofill service for quick logins in apps and browsers.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
            Spacer(modifier = Modifier.width(8.dp))
            Button(
                onClick = onEnableAutofill,
                colors = ButtonDefaults.buttonColors(
                    containerColor = MaterialTheme.colorScheme.primary,
                    contentColor = MaterialTheme.colorScheme.onPrimary
                ),
                contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
            ) {
                Text("Enable", style = MaterialTheme.typography.labelMedium)
            }
        }
    }
}

@Composable
fun AutofillSettingsDialog(
    isAutofillEnabled: Boolean,
    onDismiss: () -> Unit,
    onOpenSystemSettings: () -> Unit,
    onLaunchChrome: () -> Unit,
    chromeInstalled: Boolean
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.Settings,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        title = {
            Text("Autofill Settings")
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                verticalArrangement = Arrangement.spacedBy(16.dp)
            ) {
                // Status Section
                Surface(
                    shape = RoundedCornerShape(8.dp),
                    color = if (isAutofillEnabled) {
                        MaterialTheme.colorScheme.primaryContainer
                    } else {
                        MaterialTheme.colorScheme.errorContainer
                    },
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically
                    ) {
                        Icon(
                            if (isAutofillEnabled) Icons.Default.CheckCircle else Icons.Default.Settings,
                            contentDescription = null,
                            tint = if (isAutofillEnabled) {
                                MaterialTheme.colorScheme.onPrimaryContainer
                            } else {
                                MaterialTheme.colorScheme.onErrorContainer
                            },
                            modifier = Modifier.size(18.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = if (isAutofillEnabled) {
                                "Autofill is Active"
                            } else {
                                "Autofill is Not Enabled"
                            },
                            style = MaterialTheme.typography.labelLarge,
                            color = if (isAutofillEnabled) {
                                MaterialTheme.colorScheme.onPrimaryContainer
                            } else {
                                MaterialTheme.colorScheme.onErrorContainer
                            }
                        )
                    }
                }

                // System Autofill Settings / Enable Button
                if (!isAutofillEnabled) {
                    Button(
                        onClick = onOpenSystemSettings,
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primary,
                            contentColor = MaterialTheme.colorScheme.onPrimary
                        )
                    ) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Set as Autofill Service")
                    }
                } else {
                    OutlinedButton(
                        onClick = onOpenSystemSettings,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.Settings,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text("Open Android Settings")
                    }
                }

                HorizontalDivider()

                // Chrome Setup Section
                Column(verticalArrangement = Arrangement.spacedBy(6.dp)) {
                    Text(
                        "Chrome & Chromium Browsers",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Text(
                        "1. Open Chrome Settings (⋮ → Settings).\n" +
                        "2. Tap 'Autofill services' (or 'Passwords / Autofill').\n" +
                        "3. Select 'Autofill using another service'.\n" +
                        "4. Confirm Keygrain as your autofill provider.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    if (chromeInstalled) {
                        Spacer(modifier = Modifier.height(2.dp))
                        Button(
                            onClick = onLaunchChrome,
                            modifier = Modifier.fillMaxWidth(),
                            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 6.dp)
                        ) {
                            Icon(
                                Icons.Default.OpenInNew,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text("Open Chrome")
                        }
                    }
                }

                HorizontalDivider()

                // Firefox / Other Browsers Section
                Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                    Text(
                        "Firefox & GeckoView",
                        style = MaterialTheme.typography.titleSmall
                    )
                    Text(
                        "Firefox for Android fully supports username and password autofill. However, GeckoView does not fire autofill prompts on standalone single-field 2FA/TOTP steps (copy those directly from Keygrain).",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onDismiss) {
                Text("Done")
            }
        }
    )
}

@Composable
fun ChromeAutofillGuideDialog(
    onDismiss: () -> Unit,
    onLaunchChrome: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        icon = {
            Icon(
                Icons.Default.OpenInNew,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary
            )
        },
        title = {
            Text("Chrome Autofill Setup")
        },
        text = {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                Text(
                    "To allow Keygrain to autofill passwords in Chrome / Chromium:",
                    style = MaterialTheme.typography.bodyMedium
                )
                Text(
                    "1. Open Chrome Settings (⋮ → Settings).\n" +
                    "2. Tap 'Autofill services' (or 'Passwords / Autofill').\n" +
                    "3. Select 'Autofill using another service'.\n" +
                    "4. Confirm Keygrain as your autofill provider.",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    "Note: This is a 1-time Chrome configuration required by Android 14+ / Chromium.",
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.outline
                )
            }
        },
        confirmButton = {
            Button(onClick = onLaunchChrome) {
                Text("Open Chrome")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Done")
            }
        }
    )
}

fun launchAutofillSettings(context: Context) {
    val isEnabled = AutofillUtils.isAutofillEnabled(context)
    val targetIntent = if (!isEnabled) {
        AutofillUtils.createEnableAutofillIntent(context)
    } else {
        AutofillUtils.createAutofillSettingsIntent()
    }

    try {
        val launchIntent = Intent(targetIntent).apply {
            addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
        }
        context.startActivity(launchIntent)
    } catch (_: Exception) {
        // Fallback to general settings if OEM fails to resolve the primary intent
        try {
            val fallbackIntent = Intent(Settings.ACTION_SETTINGS).apply {
                addFlags(Intent.FLAG_ACTIVITY_NEW_TASK)
            }
            context.startActivity(fallbackIntent)
        } catch (_: Exception) {
            Toast.makeText(context, "Please configure Keygrain in Android Settings", Toast.LENGTH_LONG).show()
        }
    }
}
