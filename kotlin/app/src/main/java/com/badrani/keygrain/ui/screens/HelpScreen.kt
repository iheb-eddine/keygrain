package com.badrani.keygrain.ui.screens

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ArrowBack
import androidx.compose.material.icons.filled.ExpandLess
import androidx.compose.material.icons.filled.ExpandMore
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp

private data class FaqItem(val title: String, val content: String)

private val faqItems = listOf(
    FaqItem(
        "What is Keygrain?",
        "Keygrain is a deterministic password manager. Instead of storing passwords, it generates them on the fly from your master secret + email + site name.\n\nThe same inputs always produce the same password. Nothing is stored, nothing can be stolen from a server breach."
    ),
    FaqItem(
        "Getting started",
        "1. Enter your email address.\n2. Choose a strong master secret (passphrase). This is the only thing you need to remember.\n3. Add services (websites) — Keygrain generates a unique password for each one instantly."
    ),
    FaqItem(
        "What is my master secret?",
        "Your master secret is the single passphrase that generates all your passwords. On Android, it is stored encrypted (protected by biometric) to enable quick unlock. It is never sent to any server.\n\n⚠️ If you lose your master secret, all your passwords are lost. There is no recovery mechanism. This is by design.\n\nThe colored dots (fingerprint) help you verify you typed it correctly — same secret always shows the same colors."
    ),
    FaqItem(
        "How does sync work?",
        "Sync stores your service list (names, sites, emails, options) encrypted on the server. The encryption key is derived from your master secret + email — the server never sees your plaintext data.\n\nYour master secret and generated passwords are never transmitted."
    ),
    FaqItem(
        "How do I rotate a password?",
        "Edit the service and tap Rotate password. This increments an internal counter, generating a completely new password.\n\nAfter rotating, update the password on the actual website."
    ),
    FaqItem(
        "How do I migrate from another manager?",
        "Export from your old password manager as a file, then use Import from file in the menu to bring your data into Keygrain.\n\nYou can then update each site to use the Keygrain-generated password at your own pace."
    ),
    FaqItem(
        "What is biometric unlock?",
        "Biometric provides quick unlock without retyping your full master secret. Your secret is stored encrypted in the Android Keystore and released on successful biometric authentication.\n\nIt does NOT replace your master secret — if you clear app data, you will need your master secret again."
    ),
    FaqItem(
        "What if I forget my secret?",
        "You cannot recover it. There is no reset, no backup, no support email that can help. This is by design — nobody can access your passwords except you.\n\nRecommendation: write your master secret on paper and store it somewhere physically secure (e.g., a safe). Never store it digitally."
    ),
    FaqItem(
        "Troubleshooting",
        "Wrong password generated? Check that the email and site name match exactly what you used when you created the entry. Sites are case-insensitive, but verify the exact domain matches.\n\nSync failing? Verify the server URL in Settings and ensure you're using the same email you synced with originally."
    )
)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun HelpScreen(onBack: () -> Unit) {
    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Help") },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.Default.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        LazyColumn(
            modifier = Modifier.padding(padding),
            contentPadding = PaddingValues(16.dp),
            verticalArrangement = Arrangement.spacedBy(8.dp)
        ) {
            items(faqItems) { item ->
                FaqCard(item)
            }
        }
    }
}

@Composable
private fun FaqCard(item: FaqItem) {
    var expanded by remember { mutableStateOf(false) }
    Card(modifier = Modifier.fillMaxWidth()) {
        Column(
            modifier = Modifier
                .clickable { expanded = !expanded }
                .padding(16.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    item.title,
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f)
                )
                Icon(
                    if (expanded) Icons.Default.ExpandLess else Icons.Default.ExpandMore,
                    contentDescription = if (expanded) "Collapse" else "Expand"
                )
            }
            AnimatedVisibility(
                visible = expanded,
                enter = expandVertically(),
                exit = shrinkVertically()
            ) {
                Text(
                    item.content,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.padding(top = 8.dp)
                )
            }
        }
    }
}
