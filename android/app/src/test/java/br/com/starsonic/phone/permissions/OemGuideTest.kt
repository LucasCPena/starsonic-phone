package br.com.starsonic.phone.permissions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

/** O passo a passo dos ajustes do fabricante, pelo nome do fabricante do celular (Build.MANUFACTURER). */
class OemGuideTest {
    @Test
    fun `Xiaomi, Redmi and POCO get the Xiaomi guide`() {
        for (name in listOf("Xiaomi", "Redmi", "POCO", "xiaomi")) {
            assertEquals(name, Guide.XIAOMI, OemGuide.forManufacturer(name))
        }
    }

    @Test
    fun `samsung gets the Samsung guide`() {
        assertEquals(Guide.SAMSUNG, OemGuide.forManufacturer("samsung"))
        assertEquals(Guide.SAMSUNG, OemGuide.forManufacturer("SAMSUNG"))
    }

    @Test
    fun `motorola gets the generic guide`() {
        assertEquals(Guide.GENERIC, OemGuide.forManufacturer("motorola"))
        assertEquals(Guide.GENERIC, OemGuide.forManufacturer("Google"))
        assertEquals(Guide.GENERIC, OemGuide.forManufacturer(""))
    }

    @Test
    fun `only the Xiaomi and Samsung guides have steps`() {
        assertTrue(Guide.XIAOMI.steps.isNotEmpty())
        assertTrue(Guide.SAMSUNG.steps.isNotEmpty())
        assertTrue(Guide.GENERIC.steps.isEmpty())
    }
}
