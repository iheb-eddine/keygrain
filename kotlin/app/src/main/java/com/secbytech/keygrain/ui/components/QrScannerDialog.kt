package com.secbytech.keygrain.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.material.icons.filled.*
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat

@Composable
internal fun QrScannerDialog(onResult: (String?) -> Unit, onDismiss: () -> Unit) {
    val lifecycleOwner = androidx.compose.ui.platform.LocalLifecycleOwner.current
    var detected by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text("Scan QR Code") },
        text = {
            AndroidView(
                factory = { ctx ->
                    val previewView = androidx.camera.view.PreviewView(ctx)
                    val cameraProviderFuture = androidx.camera.lifecycle.ProcessCameraProvider.getInstance(ctx)
                    cameraProviderFuture.addListener({
                        val cameraProvider = cameraProviderFuture.get()
                        val preview = androidx.camera.core.Preview.Builder().build().also {
                            it.setSurfaceProvider(previewView.surfaceProvider)
                        }
                        val analyzer = androidx.camera.core.ImageAnalysis.Builder()
                            .setBackpressureStrategy(androidx.camera.core.ImageAnalysis.STRATEGY_KEEP_ONLY_LATEST)
                            .build()
                        analyzer.setAnalyzer(ContextCompat.getMainExecutor(ctx)) { imageProxy ->
                            @androidx.annotation.OptIn(androidx.camera.core.ExperimentalGetImage::class)
                            val mediaImage = imageProxy.image
                            if (mediaImage != null && !detected) {
                                val inputImage = com.google.mlkit.vision.common.InputImage.fromMediaImage(
                                    mediaImage, imageProxy.imageInfo.rotationDegrees
                                )
                                com.google.mlkit.vision.barcode.BarcodeScanning.getClient()
                                    .process(inputImage)
                                    .addOnSuccessListener { barcodes ->
                                        for (barcode in barcodes) {
                                            val value = barcode.rawValue
                                            if (value != null && value.startsWith("otpauth://")) {
                                                detected = true
                                                onResult(value)
                                                return@addOnSuccessListener
                                            }
                                        }
                                    }
                                    .addOnCompleteListener { imageProxy.close() }
                            } else {
                                imageProxy.close()
                            }
                        }
                        try {
                            cameraProvider.unbindAll()
                            cameraProvider.bindToLifecycle(
                                lifecycleOwner,
                                androidx.camera.core.CameraSelector.DEFAULT_BACK_CAMERA,
                                preview, analyzer
                            )
                        } catch (_: Exception) {}
                    }, ContextCompat.getMainExecutor(ctx))
                    previewView
                },
                modifier = Modifier.fillMaxWidth().height(300.dp)
            )
        },
        confirmButton = {},
        dismissButton = { TextButton(onClick = onDismiss) { Text("Cancel") } }
    )
}
