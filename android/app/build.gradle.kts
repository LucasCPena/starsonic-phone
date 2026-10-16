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

// A assinatura do APK de publicação (spec 9.5), pelas variáveis de ambiente STARSONIC_KEYSTORE_FILE (o .jks, caminho
// absoluto ou relativo à raiz do repositório), STARSONIC_KEYSTORE_PASSWORD, STARSONIC_KEY_ALIAS e
// STARSONIC_KEY_PASSWORD; o workflow android as tira dos segredos ANDROID_* do GitHub. Sem nenhuma delas, o release
// sai sem assinatura (app-release-unsigned.apk); com só algumas, o build para.
val signingVariables = listOf(
    "STARSONIC_KEYSTORE_FILE", "STARSONIC_KEYSTORE_PASSWORD", "STARSONIC_KEY_ALIAS", "STARSONIC_KEY_PASSWORD",
)
val releaseSigning: Map<String, String> = signingVariables.mapNotNull { name ->
    providers.environmentVariable(name).orNull?.takeIf { it.isNotEmpty() }?.let { name to it }
}.toMap()
if (releaseSigning.isNotEmpty() && releaseSigning.size < signingVariables.size) {
    error("assinatura do release: falta(m) ${signingVariables.filterNot { it in releaseSigning }.joinToString()}")
}

android {
    namespace = "br.com.starsonic.phone"
    // O Compose do BOM 2026.09.00 (1.12) exige compilar contra o 37. Isso só muda as APIs visíveis na
    // compilação; o comportamento do app segue o targetSdk 36.
    compileSdk = 37
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

    signingConfigs {
        if (releaseSigning.isNotEmpty()) {
            create("release") {
                storeFile = repoRoot.resolve(releaseSigning.getValue("STARSONIC_KEYSTORE_FILE"))
                storePassword = releaseSigning.getValue("STARSONIC_KEYSTORE_PASSWORD")
                keyAlias = releaseSigning.getValue("STARSONIC_KEY_ALIAS")
                keyPassword = releaseSigning.getValue("STARSONIC_KEY_PASSWORD")
            }
        }
    }

    buildTypes {
        release {
            isMinifyEnabled = true
            proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"), "proguard-rules.pro")
            if (releaseSigning.isNotEmpty()) {
                signingConfig = signingConfigs.getByName("release")
            }
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
            linha.removePrefix("\uFEFF").substringBefore(';').trim().takeIf { it.isNotEmpty() && !it.startsWith("#") }
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
    implementation(libs.androidx.work.runtime)
    implementation(libs.oboe)

    testImplementation(libs.junit)
    testImplementation(libs.org.json)

    androidTestImplementation(platform(libs.androidx.compose.bom))
    androidTestImplementation(libs.androidx.compose.ui.test.junit4)
    androidTestImplementation(libs.junit)
    androidTestImplementation(libs.androidx.test.runner)
    androidTestImplementation(libs.androidx.test.ext.junit)
    androidTestImplementation(libs.androidx.test.rules)
    androidTestImplementation(libs.androidx.test.uiautomator)
    androidTestImplementation(libs.androidx.test.espresso.intents)
}
