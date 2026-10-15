package br.com.starsonic.phone.permissions

/** O passo a passo dos ajustes do fabricante (stub). */
enum class Guide(val steps: List<String>) {
    XIAOMI(emptyList()),
    SAMSUNG(emptyList()),
    GENERIC(emptyList()),
}

/** O passo a passo de cada fabricante (stub). */
object OemGuide {
    fun forManufacturer(name: String): Guide = Guide.GENERIC
}
