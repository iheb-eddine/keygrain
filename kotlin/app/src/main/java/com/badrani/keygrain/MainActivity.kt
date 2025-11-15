package com.badrani.keygrain

import android.os.Bundle
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.fragment.app.FragmentActivity
import com.badrani.keygrain.ui.screens.MainScreen
import com.badrani.keygrain.ui.theme.KeygrainTheme

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
