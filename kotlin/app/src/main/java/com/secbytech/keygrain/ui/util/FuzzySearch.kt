package com.secbytech.keygrain.ui.util



internal fun fuzzyScore(query: String, text: String): Int {
    val q = query.lowercase()
    val t = text.lowercase()
    var qi = 0; var score = 0; var consecutive = 0; var prevIdx = -2
    for (ti in t.indices) {
        if (qi >= q.length) break
        if (t[ti] == q[qi]) {
            score++
            if (ti == prevIdx + 1) { consecutive++; score += consecutive }
            else consecutive = 0
            if (ti == 0) score += 2
            if (ti > 0 && t[ti - 1].let { it == ' ' || it == '-' || it == '_' || it == '.' }) score += 2
            prevIdx = ti
            qi++
        }
    }
    return if (qi == q.length) score else 0
}
