# Biometric-First Unlock

When biometric is available AND a secret is stored in the keystore, the unlock screen shows only the logo and biometric button initially. The manual secret text field is hidden until biometric fails, is cancelled, or the user taps "Use secret instead." This matches banking app patterns (biometric prompt first, manual entry as fallback). The biometric button remains visible after manual entry is revealed so users can retry.
