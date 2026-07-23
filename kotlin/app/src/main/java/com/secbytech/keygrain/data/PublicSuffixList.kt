package com.secbytech.keygrain.data

import android.content.Context
import java.net.IDN

object PublicSuffixList {
    private var trie: TrieNode? = null

    private class TrieNode {
        val children = mutableMapOf<String, TrieNode>()
        var isTerminal = false
        var isWildcard = false
        val exceptions = mutableSetOf<String>()
    }

    fun getInstance(context: Context): PublicSuffixList {
        if (trie == null) {
            synchronized(this) {
                if (trie == null) {
                    trie = parsePsl(context.applicationContext.assets.open("public_suffix_list.dat").bufferedReader().readText())
                }
            }
        }
        return this
    }

    /** For testing without Android context */
    internal fun initFromString(pslContent: String) {
        synchronized(this) { trie = parsePsl(pslContent) }
    }

    internal fun reset() {
        synchronized(this) { trie = null }
    }

    private fun parsePsl(content: String): TrieNode {
        val root = TrieNode()
        for (line in content.lineSequence()) {
            val trimmed = line.trim()
            if (trimmed.isEmpty() || trimmed.startsWith("//")) continue

            when {
                trimmed.startsWith("!") -> {
                    // Exception rule: !www.ck -> exception "www" on node for "ck"
                    val domain = trimmed.substring(1)
                    val labels = domain.split(".").reversed()
                    if (labels.size >= 2) {
                        var node = root
                        // Navigate to parent (all labels except the first reversed = all except last original)
                        for (i in 0 until labels.size - 1) {
                            node = node.children.getOrPut(labels[i]) { TrieNode() }
                        }
                        node.exceptions.add(labels.last())
                    }
                }
                trimmed.startsWith("*.") -> {
                    // Wildcard rule: *.ck -> node for "ck" gets isWildcard=true
                    val domain = trimmed.substring(2)
                    val labels = domain.split(".").reversed()
                    var node = root
                    for (label in labels) {
                        node = node.children.getOrPut(label) { TrieNode() }
                    }
                    node.isWildcard = true
                }
                else -> {
                    // Normal rule
                    val labels = trimmed.split(".").reversed()
                    var node = root
                    for (label in labels) {
                        node = node.children.getOrPut(label) { TrieNode() }
                    }
                    node.isTerminal = true
                }
            }
        }
        return root
    }

    private val ipv4Regex = Regex("""^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$""")

    fun extractRegistrableDomain(domain: String): String? {
        if (domain.isBlank()) return null

        // Strip port
        val noPort = if (domain.contains(":") && !domain.startsWith("[")) {
            domain.substringBefore(":")
        } else {
            domain
        }

        // IPv6
        if (noPort.startsWith("[")) return noPort
        // IPv4
        if (ipv4Regex.matches(noPort)) return noPort

        // Normalize IDN to ASCII
        val normalized = try {
            IDN.toASCII(noPort).lowercase()
        } catch (_: Exception) {
            noPort.lowercase()
        }

        // Split into labels
        val labels = normalized.split(".")
        if (labels.isEmpty()) return null

        val root = trie ?: return normalized

        // Walk trie with reversed labels to find longest matching public suffix
        val reversed = labels.reversed() // e.g., ["com", "google", "accounts"]
        var node = root
        var suffixLength = 0 // number of labels matched as public suffix

        for (i in reversed.indices) {
            val label = reversed[i]
            val child = node.children[label]
            if (child != null) {
                node = child
                if (node.isTerminal) {
                    suffixLength = i + 1
                }
                // Check wildcard: if this node has isWildcard and there's a next label
                if (node.isWildcard && i + 1 < reversed.size) {
                    val nextLabel = reversed[i + 1]
                    if (nextLabel !in node.exceptions) {
                        // Wildcard matches: suffix = i+1 (current) + 1 (wildcard match)
                        suffixLength = i + 2
                    } else {
                        // Exception: the wildcard doesn't apply, current suffix stands
                    }
                }
            } else {
                // Check if parent had wildcard
                if (node.isWildcard) {
                    if (label !in node.exceptions) {
                        suffixLength = i + 1
                    }
                }
                break
            }
        }

        // Fallback: if TLD not in trie at all, treat as single-label TLD
        if (suffixLength == 0) {
            if (root.children.containsKey(reversed[0])) {
                // TLD is known but no deeper match -> TLD itself is the suffix
                suffixLength = 1
            } else {
                // Unknown TLD -> treat last label as TLD only for multi-label domains
                if (labels.size > 1) suffixLength = 1
            }
        }

        // Registrable domain = suffix + 1 label
        if (suffixLength >= labels.size) return null // domain IS a public suffix
        val registrableLabels = labels.size - suffixLength
        return labels.subList(registrableLabels - 1, labels.size).joinToString(".")
    }
}
