package com.badrani.keygrain.ui.screens

import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.widget.Toast
import androidx.activity.compose.BackHandler
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.expandVertically
import androidx.compose.animation.shrinkVertically
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.unit.dp
import com.badrani.keygrain.data.Keygrain
import com.badrani.keygrain.data.SecretManager
import com.badrani.keygrain.data.ServiceEntry
import com.badrani.keygrain.data.ServiceManager
import com.badrani.keygrain.ui.WongPalette
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun OnboardingWizard(
    secretManager: SecretManager,
    serviceManager: ServiceManager,
    onComplete: (masterSecret: String?) -> Unit
) {
    val pagerState = rememberPagerState(pageCount = { 5 })
    val scope = rememberCoroutineScope()

    var masterSecret by remember { mutableStateOf<String?>(null) }
    var addedServiceName by remember { mutableStateOf<String?>(null) }

    BackHandler(enabled = pagerState.currentPage > 0) {
        scope.launch { pagerState.animateScrollToPage(pagerState.currentPage - 1) }
    }

    Column(modifier = Modifier.fillMaxSize()) {
        // Page indicator
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(top = 48.dp, bottom = 16.dp),
            horizontalArrangement = Arrangement.Center
        ) {
            repeat(5) { i ->
                Box(
                    modifier = Modifier
                        .padding(horizontal = 4.dp)
                        .size(8.dp)
                        .background(
                            if (i == pagerState.currentPage) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.outlineVariant,
                            CircleShape
                        )
                )
            }
        }

        HorizontalPager(
            state = pagerState,
            userScrollEnabled = false,
            modifier = Modifier.fillMaxSize()
        ) { page ->
            when (page) {
                0 -> WelcomePage(
                    onNext = { scope.launch { pagerState.animateScrollToPage(1) } },
                    onSkip = { onComplete(null) }
                )
                1 -> MasterSecretPage(
                    secretManager = secretManager,
                    onSecretSet = { secret ->
                        masterSecret = secret
                        scope.launch { pagerState.animateScrollToPage(2) }
                    },
                    onSkip = { onComplete(null) }
                )
                2 -> FirstServicePage(
                    masterSecret = masterSecret,
                    serviceManager = serviceManager,
                    onServiceAdded = { name ->
                        addedServiceName = name
                        scope.launch { pagerState.animateScrollToPage(3) }
                    },
                    onSkip = { onComplete(masterSecret) },
                    onBack = { scope.launch { pagerState.animateScrollToPage(1) } }
                )
                3 -> BackupInfoPage(
                    onNext = { scope.launch { pagerState.animateScrollToPage(4) } },
                    onSkip = { onComplete(masterSecret) }
                )
                4 -> CompletionPage(
                    secretSet = masterSecret != null,
                    serviceName = addedServiceName,
                    onGetStarted = { onComplete(masterSecret) }
                )
            }
        }
    }
}

@Composable
private fun WelcomePage(onNext: () -> Unit, onSkip: () -> Unit) {
    OnboardingPageLayout(
        skipLabel = "Skip setup",
        onSkip = onSkip,
        primaryLabel = "Next →",
        onPrimary = onNext
    ) {
        Text("Welcome to Keygrain", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(24.dp))
        Text(
            "Keygrain generates unique passwords from one master secret. " +
                "Your passwords are never stored anywhere — they're mathematically derived every time you need them.\n\n" +
                "Same secret + same service = same password. Always.\n\n" +
                "This means: no database to hack, no cloud to breach, no sync to fail. " +
                "But also: if you forget your secret, your passwords cannot be recovered.",
            style = MaterialTheme.typography.bodyLarge
        )
    }
}

@Composable
private fun MasterSecretPage(
    secretManager: SecretManager,
    onSecretSet: (String) -> Unit,
    onSkip: () -> Unit
) {
    var secret by remember { mutableStateOf("") }
    var secretVisible by remember { mutableStateOf(false) }
    var fingerprintIndices by remember { mutableStateOf<List<Int>>(emptyList()) }

    LaunchedEffect(secret) {
        if (secret.isEmpty()) { fingerprintIndices = emptyList(); return@LaunchedEffect }
        delay(500)
        fingerprintIndices = Keygrain.secretFingerprint(secret.toByteArray())
    }

    OnboardingPageLayout(
        onSkip = onSkip,
        primaryLabel = "Set Master Secret",
        onPrimary = {
            secretManager.saveSecret(secret)
            onSecretSet(secret)
        },
        primaryEnabled = secret.isNotBlank()
    ) {
        Text("Your Master Secret", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(16.dp))
        Text(
            "This is the single passphrase that generates all your passwords. " +
                "Choose something memorable but hard to guess.\n\n" +
                "Tips:\n• Use a phrase only you would know\n• Longer is better (4+ words recommended)\n" +
                "• You'll need to remember this exactly — there's no reset",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(24.dp))
        OutlinedTextField(
            value = secret,
            onValueChange = { secret = it },
            label = { Text("Master Secret") },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            keyboardOptions = KeyboardOptions(autoCorrect = false, keyboardType = KeyboardType.Password),
            visualTransformation = if (secretVisible) VisualTransformation.None else PasswordVisualTransformation(),
            trailingIcon = {
                IconButton(onClick = { secretVisible = !secretVisible }) {
                    Icon(
                        if (secretVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = "Toggle visibility"
                    )
                }
            }
        )
        if (fingerprintIndices.isNotEmpty()) {
            Spacer(Modifier.height(12.dp))
            Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                fingerprintIndices.forEach { idx ->
                    Box(Modifier.size(16.dp).background(WongPalette[idx], CircleShape))
                }
            }
            Spacer(Modifier.height(8.dp))
            Text(
                "These colors are your secret's fingerprint. They'll always be the same for the same secret — use them to verify you typed it correctly.",
                style = MaterialTheme.typography.bodySmall
            )
        }
    }
}

@Composable
private fun FirstServicePage(
    masterSecret: String?,
    serviceManager: ServiceManager,
    onServiceAdded: (String) -> Unit,
    onSkip: () -> Unit,
    onBack: () -> Unit
) {
    if (masterSecret == null) {
        OnboardingPageLayout(
            onSkip = onSkip,
            primaryLabel = "← Back to set secret",
            onPrimary = onBack
        ) {
            Text("Add Your First Service", style = MaterialTheme.typography.headlineMedium)
            Spacer(Modifier.height(24.dp))
            Text(
                "Set up your master secret first to generate passwords.",
                style = MaterialTheme.typography.bodyLarge
            )
        }
        return
    }

    val context = LocalContext.current
    var name by remember { mutableStateOf("google.com") }
    var site by remember { mutableStateOf("google.com") }
    var email by remember { mutableStateOf("") }
    var length by remember { mutableStateOf("20") }
    var symbols by remember { mutableStateOf(Keygrain.DEFAULT_SYMBOLS) }
    var showAdvanced by remember { mutableStateOf(false) }
    var passwordVisible by remember { mutableStateOf(false) }

    val password = remember(name, site, email, length, symbols, masterSecret) {
        if (email.isBlank() || site.isBlank()) return@remember null
        val len = (length.toIntOrNull() ?: 20).coerceAtLeast(8)
        val syms = symbols.ifEmpty { Keygrain.DEFAULT_SYMBOLS }
        try {
            Keygrain.derivePassword(
                secret = masterSecret.toByteArray(),
                email = email.trim(),
                site = site.trim(),
                length = len,
                symbols = syms
            )
        } catch (_: Exception) { null }
    }

    OnboardingPageLayout(
        onSkip = onSkip,
        primaryLabel = "Add Service",
        onPrimary = {
            serviceManager.addService(
                ServiceEntry(
                    name = name.trim(),
                    site = site.trim().ifEmpty { name.trim().lowercase() },
                    email = email.trim(),
                    length = (length.toIntOrNull() ?: 20).coerceAtLeast(8),
                    symbols = symbols.ifEmpty { Keygrain.DEFAULT_SYMBOLS }
                )
            )
            onServiceAdded(name.trim())
        },
        primaryEnabled = name.isNotBlank() && email.isNotBlank()
    ) {
        Text("Add Your First Service", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(8.dp))
        Text(
            "Let's generate a password for a service you use. We've pre-filled an example — edit it to match your account.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(16.dp))
        OutlinedTextField(
            value = name,
            onValueChange = { name = it; if (it.contains(".")) site = it.lowercase() },
            label = { Text("Service name") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = site,
            onValueChange = { site = it },
            label = { Text("Site") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth()
        )
        Spacer(Modifier.height(8.dp))
        OutlinedTextField(
            value = email,
            onValueChange = { email = it },
            label = { Text("Email") },
            singleLine = true,
            modifier = Modifier.fillMaxWidth(),
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email)
        )
        TextButton(onClick = { showAdvanced = !showAdvanced }) {
            Text(if (showAdvanced) "⚙️ Hide options" else "⚙️ Options")
        }
        AnimatedVisibility(visible = showAdvanced, enter = expandVertically(), exit = shrinkVertically()) {
            Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                OutlinedTextField(
                    value = length,
                    onValueChange = { length = it.filter { c -> c.isDigit() } },
                    label = { Text("Length") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth(),
                    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number)
                )
                OutlinedTextField(
                    value = symbols,
                    onValueChange = { symbols = it },
                    label = { Text("Symbols") },
                    singleLine = true,
                    modifier = Modifier.fillMaxWidth()
                )
            }
        }
        if (password != null) {
            Spacer(Modifier.height(16.dp))
            Row(verticalAlignment = Alignment.CenterVertically) {
                Text(
                    text = if (passwordVisible) password else "••••••••••••",
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f)
                )
                IconButton(onClick = { passwordVisible = !passwordVisible }) {
                    Icon(
                        if (passwordVisible) Icons.Default.VisibilityOff else Icons.Default.Visibility,
                        contentDescription = "Toggle"
                    )
                }
                IconButton(onClick = {
                    val clipboard = context.getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
                    clipboard.setPrimaryClip(ClipData.newPlainText("password", password))
                    Toast.makeText(context, "Copied", Toast.LENGTH_SHORT).show()
                }) {
                    Icon(Icons.Default.ContentCopy, contentDescription = "Copy")
                }
            }
        }
    }
}

@Composable
private fun BackupInfoPage(onNext: () -> Unit, onSkip: () -> Unit) {
    OnboardingPageLayout(
        onSkip = onSkip,
        primaryLabel = "Next →",
        onPrimary = onNext
    ) {
        Text("Keep Your Services Safe", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(24.dp))
        Text(
            "Your master secret is never backed up (only you know it). " +
                "But your service list (names, emails, settings) can be backed up to prevent re-entering them.\n\n" +
                "Options available in the menu (⋮):\n" +
                "• Backup to server — encrypted with your secret\n" +
                "• Export to file — save locally or share\n\n" +
                "You can set this up anytime from the main screen menu.",
            style = MaterialTheme.typography.bodyLarge
        )
    }
}

@Composable
private fun CompletionPage(
    secretSet: Boolean,
    serviceName: String?,
    onGetStarted: () -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .verticalScroll(rememberScrollState()),
        verticalArrangement = Arrangement.Center
    ) {
        Text("You're All Set! ✓", style = MaterialTheme.typography.headlineMedium)
        Spacer(Modifier.height(24.dp))
        Text("Here's what you've set up:", style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(12.dp))
        if (secretSet) {
            Text("✓ Master secret configured", style = MaterialTheme.typography.bodyMedium)
        } else {
            Text("○ Master secret — set up on next screen", style = MaterialTheme.typography.bodyMedium)
        }
        if (serviceName != null) {
            Text("✓ First service added ($serviceName)", style = MaterialTheme.typography.bodyMedium)
        } else {
            Text("○ Add services anytime with the + button", style = MaterialTheme.typography.bodyMedium)
        }
        Text("✓ Backup available in menu", style = MaterialTheme.typography.bodyMedium)
        Spacer(Modifier.height(24.dp))
        Text(
            "Remember: your master secret is the key to everything. Keep it safe, keep it memorable.",
            style = MaterialTheme.typography.bodyMedium
        )
        Spacer(Modifier.height(32.dp))
        Button(
            onClick = onGetStarted,
            modifier = Modifier.fillMaxWidth()
        ) {
            Text("Get Started")
        }
    }
}

@Composable
private fun OnboardingPageLayout(
    skipLabel: String = "Skip",
    onSkip: () -> Unit,
    primaryLabel: String,
    onPrimary: () -> Unit,
    primaryEnabled: Boolean = true,
    content: @Composable ColumnScope.() -> Unit
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(horizontal = 24.dp)
            .verticalScroll(rememberScrollState())
    ) {
        Column(modifier = Modifier.weight(1f), verticalArrangement = Arrangement.Center) {
            content()
        }
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(bottom = 32.dp),
            horizontalArrangement = Arrangement.SpaceBetween,
            verticalAlignment = Alignment.CenterVertically
        ) {
            TextButton(onClick = onSkip) { Text(skipLabel) }
            Button(onClick = onPrimary, enabled = primaryEnabled) { Text(primaryLabel) }
        }
    }
}
