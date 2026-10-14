import org.jetbrains.kotlin.gradle.dsl.JvmTarget

plugins {
    alias(libs.plugins.android.application)
    alias(libs.plugins.kotlin.compose)
}

// Propriedades do build (-P na linha de comando do Gradle):
//   starsonic.version      versionName (padrão 0.0.0)
//   starsonic.versionCode  versionCode (padrão 1; build/android/version_code.py dá o de cada versão)
//   starsonic.deps         a pasta android-deps (build/android/build-deps.sh), absoluta ou relativa à raiz
//                          do repositório (padrão android-deps)
//   starsonic.abis         ABIs separadas por vírgula (padrão arm64-v8a,armeabi-v7a,x86_64)
val repoRoot: File = rootDir.parentFile

fun starsonicProperty(name: String, default: String): String =
    providers.gradleProperty(name).orNull?.trim()?.takeIf { it.isNotEmpty() } ?: default

val starsonicVersion = starsonicProperty("starsonic.version", "0.0.0")
val starsonicVersionCode = starsonicProperty("starsonic.versionCode", "1").let {
    it.toIntOrNull()?.takeIf { code -> code >= 1 } ?: error("starsonic.versionCode inválido: $it")
}
val starsonicDeps: String = repoRoot.resolve(starsonicProperty("starsonic.deps", "android-deps")).absolutePath
val starsonicAbis = starsonicProperty("starsonic.abis", "arm64-v8a,armeabi-v7a,x86_64")
    .split(',').map { it.trim() }.filter { it.isNotEmpty() }

android {
    namespace = "br.com.starsonic.phone"
    compileSdk = 36
    ndkVersion = libs.versions.ndk.get()

    defaultConfig {
        applicationId = "br.com.starsonic.phone"
        minSdk = 28
        targetSdk = 36
        versionCode = starsonicVersionCode
        versionName = starsonicVersion
        testInstrumentationRunner = "androidx.test.runner.AndroidJUnitRunner"

        ndk {
            abiFilters += starsonicAbis
        }
        externalNativeBuild {
            cmake {
                arguments += listOf("-DANDROID_STL=c++_shared", "-DSTARSONIC_ANDROID_DEPS=$starsonicDeps")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
        }
    }

    compileOptions {
        sourceCompatibility = JavaVersion.VERSION_17
        targetCompatibility = JavaVersion.VERSION_17
    }

    buildFeatures {
        compose = true
        prefab = true
        buildConfig = true
    }

    externalNativeBuild {
        cmake {
            path = file("src/main/cpp/CMakeLists.txt")
        }
    }
}

kotlin {
    compilerOptions {
        jvmTarget = JvmTarget.JVM_17
    }
}

// O perfil das contas (branding/perfil.ini) vai nos assets como no executável do Windows
// (build/Build-App.ps1): sem os comentários, pela regra do leitor do núcleo (tudo depois do primeiro ';'
// é comentário; linhas vazias e as que começam com '#' saem).
abstract class PerfilSemComentarios : DefaultTask() {
    @get:InputFile
    @get:PathSensitive(PathSensitivity.NONE)
    abstract val perfil: RegularFileProperty

    @get:OutputDirectory
    abstract val saida: DirectoryProperty

    @TaskAction
    fun gerar() {
        val linhas = perfil.get().asFile.readLines(Charsets.UTF_8).mapNotNull { linha ->
            linha.removePrefix("﻿").substringBefore(';').trim().takeIf { it.isNotEmpty() && !it.startsWith("#") }
        }
        saida.get().file("perfil.ini").asFile.writeText(linhas.joinToString("\n", postfix = "\n"), Charsets.UTF_8)
    }
}

val perfilSemComentarios = tasks.register<PerfilSemComentarios>("perfilSemComentarios") {
    perfil.set(repoRoot.resolve("branding/perfil.ini"))
}

androidComponents {
    onVariants { variant ->
        variant.sources.assets?.addGeneratedSourceDirectory(perfilSemComentarios, PerfilSemComentarios::saida)
    }
}

dependencies {
    implementation(platform(libs.androidx.compose.bom))
    implementation(libs.androidx.compose.material3)
    implementation(libs.androidx.activity.compose)
    implementation(libs.androidx.core.splashscreen)
    implementation(libs.oboe)

    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
}
