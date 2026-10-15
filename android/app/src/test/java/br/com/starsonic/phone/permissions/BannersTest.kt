package br.com.starsonic.phone.permissions

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/** A faixa de avisos: um por vez, na ordem da prioridade (Global Constraints). */
class BannersTest {
    @Test
    fun `everything denied shows the notifications banner`() {
        val banner = Banners.first(notificationsOk = false, microphoneOk = false, fullScreenOk = false, batteryOk = false)
        assertEquals(Banner.NOTIFICATIONS, banner)
        assertEquals("Permita as notificações para receber ligações.", banner?.text)
    }

    @Test
    fun `only the battery shows the battery banner`() {
        val banner = Banners.first(notificationsOk = true, microphoneOk = true, fullScreenOk = true, batteryOk = false)
        assertEquals(Banner.BATTERY, banner)
        assertEquals("Libere o uso de bateria para receber ligações com o app fechado.", banner?.text)
    }

    @Test
    fun `everything allowed shows no banner`() {
        assertNull(Banners.first(notificationsOk = true, microphoneOk = true, fullScreenOk = true, batteryOk = true))
    }

    @Test
    fun `the banners follow the priority`() {
        assertEquals(Banner.MICROPHONE, Banners.first(true, false, false, false))
        assertEquals("Permita o microfone para fazer e receber ligações.", Banner.MICROPHONE.text)
        assertEquals(Banner.FULL_SCREEN, Banners.first(true, true, false, false))
        assertEquals("Permita a tela cheia para ver as ligações com o celular bloqueado.", Banner.FULL_SCREEN.text)
        // A tela Permissões mostra todos os que faltam, na mesma ordem.
        assertEquals(
            listOf(Banner.NOTIFICATIONS, Banner.FULL_SCREEN, Banner.BATTERY),
            Banners.missing(notificationsOk = false, microphoneOk = true, fullScreenOk = false, batteryOk = false),
        )
    }
}
