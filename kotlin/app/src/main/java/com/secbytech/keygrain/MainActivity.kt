package com.secbytech.keygrain

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import com.secbytech.keygrain.ui.screens.MainScreen
import com.secbytech.keygrain.ui.theme.KeygrainTheme

class MainActivity : FragmentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            KeygrainTheme {
                MainScreen()
            }
        }
    }
}
