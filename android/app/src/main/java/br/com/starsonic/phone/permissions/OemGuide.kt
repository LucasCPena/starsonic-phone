package br.com.starsonic.phone.permissions

import java.util.Locale

/**
 * O passo a passo para liberar o app nos ajustes do fabricante (spec 7.2): Xiaomi e Samsung fecham apps em
 * segundo plano além do que o Android pede. Os passos começam pelo botão "Abrir ajustes" da tela Permissões,
 * que abre a página do app nos ajustes do Android. GENERIC: nada a mostrar.
 */
enum class Guide(val title: String, val steps: List<String>) {
    XIAOMI(
        "No Xiaomi, libere também o app nos ajustes:",
        listOf(
            "Toque em Abrir ajustes.",
            "Ative Início automático.",
            "Em Economia de bateria, escolha Sem restrições.",
        ),
    ),
    SAMSUNG(
        "No Samsung, libere também o app nos ajustes:",
        listOf(
            "Toque em Abrir ajustes.",
            "Toque em Bateria.",
            "Escolha Sem restrições.",
        ),
    ),
    GENERIC("", emptyList()),
}

/** O passo a passo de cada fabricante, pelo nome dele (Build.MANUFACTURER), sem diferenciar maiúsculas. */
object OemGuide {
    fun forManufacturer(name: String): Guide = when (name.trim().lowercase(Locale.ROOT)) {
        "xiaomi", "redmi", "poco" -> Guide.XIAOMI
        "samsung" -> Guide.SAMSUNG
        else -> Guide.GENERIC
    }
}
