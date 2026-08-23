# Project specific ProGuard rules.

# ML Kit barcode scanning (bundled model — must survive shrinking for offline use)
-keep class com.google.mlkit.** { *; }
-keep class com.google.android.gms.internal.mlkit_vision_barcode.** { *; }
-dontwarn com.google.mlkit.**

# VisionCamera
-keep class com.mrousavy.camera.** { *; }

# op-sqlite JSI bindings
-keep class com.op.sqlite.** { *; }

# react-native-image-crop-picker / uCrop
-keep class com.yalantis.ucrop** { *; }
-keep interface com.yalantis.ucrop** { *; }
-dontwarn com.yalantis.ucrop**
