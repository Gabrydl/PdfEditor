plugins {
    id("com.android.application")
    id("org.jetbrains.kotlin.android")
}

// The app itself is the repository's www/ folder (same code as the Windows app): it is copied into the APK at build time.
val wwwOut = layout.buildDirectory.dir("generated/www")
val copyWww by tasks.registering(Copy::class) {
    from(rootProject.file("../www"))
    into(wwwOut.map { it.dir("www") })
}

android {
    namespace = "com.gpe.pdf"
    compileSdk = 35

    defaultConfig {
        applicationId = "com.gpe.pdf"
        minSdk = 24
        targetSdk = 34
        // must stay above the APK already on the phone (100000), so it installs as an update
        versionCode = (project.findProperty("appCode") as String?)?.toInt() ?: 100700
        versionName = (project.findProperty("appVersion") as String?) ?: "1.7.0"
    }

    sourceSets["main"].assets.srcDir(wwwOut)

    buildTypes {
        release { isMinifyEnabled = false }
    }

    // wasm, OCR data and fonts are read as they are
    androidResources { noCompress += listOf("wasm", "gz", "woff2") }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }
    kotlinOptions { jvmTarget = "17" }
    lint { checkReleaseBuilds = false; abortOnError = false }
}

tasks.named("preBuild") { dependsOn(copyWww) }

dependencies {
    implementation("androidx.core:core-ktx:1.13.1")
    implementation("androidx.activity:activity-ktx:1.9.3")
}
