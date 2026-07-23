plugins {
    id("com.android.application") version "8.9.1" apply false
    // Contingency (inactive): if Kotlin 1.9.22 (KGP) fails to build on Gradle 8.11.1,
    // bump to Kotlin 2.0.21 and add the org.jetbrains.kotlin.plugin.compose plugin.
    id("org.jetbrains.kotlin.android") version "1.9.22" apply false
}
