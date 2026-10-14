plugins {
    alias(libs.plugins.android.application) apply false
    // O AGP 9 compila o Kotlin sozinho (sem aplicar este plugin); declará-lo aqui só fixa a versão do
    // Kotlin no classpath, a mesma do plugin do compilador do Compose.
    alias(libs.plugins.kotlin.android) apply false
    alias(libs.plugins.kotlin.compose) apply false
}
