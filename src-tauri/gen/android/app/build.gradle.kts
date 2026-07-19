import java.util.Properties

plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
    id("rust")
}

val tauriProperties = Properties().apply {
    val propFile = file("tauri.properties")
    if (propFile.exists()) {
        propFile.inputStream().use { load(it) }
    }
}

// One Gradle project, two Tauri identifiers: production `net.puetsua.pansutong`
// (CI release) and `net.puetsua.pansutong.dev` (local testing via
// tauri.android-dev.conf.json). The Tauri CLI writes the merged config into
// assets before invoking Gradle and generates TauriActivity under the ACTIVE
// identifier's package, so the two MainActivity variants can never compile in
// the same build — the inactive package tree is excluded below. Defaults to
// production when the CLI hasn't run (e.g. a bare Android Studio sync).
val prodAppId = "net.puetsua.pansutong"
val devAppId = "$prodAppId.dev"
val mergedTauriConf = file("src/main/assets/tauri.conf.json")
val isDevId = mergedTauriConf.exists() &&
    Regex("\"identifier\"\\s*:\\s*\"${Regex.escape(devAppId)}\"")
        .containsMatchIn(mergedTauriConf.readText())
val tauriAppId = if (isDevId) devAppId else prodAppId
val tauriAppLabel = if (isDevId) "Pansuthong Dev" else "Pansuthong"
// The inactive identifier's Kotlin sources: its MainActivity plus any stale
// CLI-generated tree from a previous build of the other identifier — those
// classes reference a TauriActivity that doesn't exist in this build.
val inactiveIdSources = if (isDevId) {
    listOf("net/puetsua/pansutong/MainActivity.kt", "net/puetsua/pansutong/generated/**")
} else {
    listOf("net/puetsua/pansutong/dev/**")
}

// Release signing. CI writes keystore.properties + the keystore from secrets
// (see .github/workflows/release.yml). When the file is absent (local dev),
// the release build stays unsigned rather than failing.
val keystorePropertiesFile = rootProject.file("keystore.properties")
val keystoreProperties = Properties().apply {
    if (keystorePropertiesFile.exists()) {
        keystorePropertiesFile.inputStream().use { load(it) }
    }
}

android {
    compileSdk = 36
    // Follows the active identifier: the CLI-generated Kotlin (Logger.kt) does
    // an unqualified BuildConfig reference, so BuildConfig must be generated in
    // the same package the CLI writes its sources into.
    namespace = tauriAppId
    defaultConfig {
        manifestPlaceholders["usesCleartextTraffic"] = "false"
        manifestPlaceholders["mainActivityClass"] = "$tauriAppId.MainActivity"
        manifestPlaceholders["appLabel"] = tauriAppLabel
        applicationId = tauriAppId
        minSdk = 24
        targetSdk = 36
        versionCode = tauriProperties.getProperty("tauri.android.versionCode", "1").toInt()
        versionName = tauriProperties.getProperty("tauri.android.versionName", "1.0")
    }
    signingConfigs {
        create("release") {
            if (keystorePropertiesFile.exists()) {
                keyAlias = keystoreProperties.getProperty("keyAlias")
                keyPassword = keystoreProperties.getProperty("password")
                storeFile = file(keystoreProperties.getProperty("storeFile"))
                storePassword = keystoreProperties.getProperty("storePassword")
            }
        }
    }
    buildTypes {
        getByName("debug") {
            manifestPlaceholders["usesCleartextTraffic"] = "true"
            isDebuggable = true
            isJniDebuggable = true
            isMinifyEnabled = false
            packaging {                jniLibs.keepDebugSymbols.add("*/arm64-v8a/*.so")
                jniLibs.keepDebugSymbols.add("*/armeabi-v7a/*.so")
                jniLibs.keepDebugSymbols.add("*/x86/*.so")
                jniLibs.keepDebugSymbols.add("*/x86_64/*.so")
            }
        }
        getByName("release") {
            if (keystorePropertiesFile.exists()) {
                signingConfig = signingConfigs.getByName("release")
            }
            isMinifyEnabled = true
            proguardFiles(
                *fileTree(".") { include("**/*.pro") }
                    .plus(getDefaultProguardFile("proguard-android-optimize.txt"))
                    .toList().toTypedArray()
            )
        }
    }
    kotlinOptions {
        jvmTarget = "1.8"
    }
    buildFeatures {
        buildConfig = true
    }
}

rust {
    rootDirRel = "../../../"
}

// Compile only the active identifier's sources (see inactiveIdSources above).
tasks.withType<org.jetbrains.kotlin.gradle.tasks.KotlinCompile>().configureEach {
    exclude(inactiveIdSources)
}

dependencies {
    implementation("androidx.webkit:webkit:1.14.0")
    implementation("androidx.appcompat:appcompat:1.7.1")
    implementation("androidx.activity:activity-ktx:1.10.1")
    implementation("com.google.android.material:material:1.12.0")
    implementation("androidx.lifecycle:lifecycle-process:2.10.0")
    testImplementation("junit:junit:4.13.2")
    androidTestImplementation("androidx.test.ext:junit:1.1.4")
    androidTestImplementation("androidx.test.espresso:espresso-core:3.5.0")
}

apply(from = "tauri.build.gradle.kts")