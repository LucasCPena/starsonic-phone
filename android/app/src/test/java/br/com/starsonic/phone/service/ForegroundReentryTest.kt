package br.com.starsonic.phone.service

import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.call.CallUi
import br.com.starsonic.phone.call.SecondKind
import br.com.starsonic.phone.call.SecondUi
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

/**
 * Os tipos do primeiro plano do serviço quando a ligação muda (F1, [ForegroundReentry]), comparados com o que o Android
 * aceitou da última vez: o microfone recusado ao Atender automático volta quando a pessoa atende à mão, e os tipos da
 * ligação saem com ela, também depois de um Atender automático que não atendeu. O Android do teste ([FakeAndroid])
 * aceita o primeiro tipo pedido, menos os com o microfone enquanto o recusa (o app fechado, Android 14+).
 */
class ForegroundReentryTest {
    private val android = FakeAndroid()
    private val reentry = ForegroundReentry({ CALL_TYPES }, { BASE_TYPES })

    @Test
    fun `a microphone refused to the auto answer is asked again when the person answers by hand`() {
        startWithoutACall()
        assertNull("a recebida toca", changed(ringing()))
        // O Atender automático pede os tipos da ligação antes de atender, e o Android não deixa o microfone: ela continua
        // tocando, e o serviço fica com o phoneCall.
        android.refusesMicrophone = true
        assertEquals(PHONE_CALL, android.enter(CALL_TYPES))
        assertNull("ainda tocando", changed(ringing(autoAnswerSeconds = null)))
        // A pessoa atende à mão, com o app na frente: os tipos da ligação de novo, agora com o microfone.
        android.refusesMicrophone = false
        assertEquals(CALL_TYPES, changed(answered()))
        assertEquals(WITH_MICROPHONE, android.accepted)
        assertNull("em andamento, nada muda", changed(answered(phase = CallPhase.ACTIVE)))
        // No fim, os de sempre.
        assertEquals(BASE_TYPES, changed(null))
    }

    @Test
    fun `the call types leave when the call the auto answer prepared stops ringing unanswered`() {
        startWithoutACall()
        assertNull(changed(ringing()))
        // Os tipos da ligação entraram para o Atender automático (com o microfone), mas ele não atendeu (a regra mudou no
        // meio) e quem ligou desistiu: sem ligação, os de sempre.
        assertEquals(WITH_MICROPHONE, android.enter(CALL_TYPES))
        assertEquals(BASE_TYPES, changed(null))
        assertEquals(BASE, android.accepted)
    }

    @Test
    fun `the ringing call keeps the types the auto answer gave it until it is answered`() {
        startWithoutACall()
        assertNull(changed(ringing()))
        assertEquals(WITH_MICROPHONE, android.enter(CALL_TYPES))
        assertNull("a contagem que muda não tira os tipos", changed(ringing(autoAnswerSeconds = null)))
        assertNull("atendida, os tipos já estão lá", changed(answered()))
    }

    @Test
    fun `a call that uses the microphone brings the call types and takes them away at its end`() {
        startWithoutACall()
        assertEquals("a feita", CALL_TYPES, changed(outgoing()))
        assertNull("atendida pelo outro lado", changed(outgoing(phase = CallPhase.ACTIVE)))
        assertEquals(BASE_TYPES, changed(null))
        assertNull("sem ligação, nada muda", changed(null))
    }

    @Test
    fun `the second call left ringing keeps the call types of the first`() {
        startWithoutACall()
        assertEquals(CALL_TYPES, changed(answered(phase = CallPhase.ACTIVE)))
        assertNull("a segunda toca na faixa", changed(answered(phase = CallPhase.ACTIVE, second = SECOND_RINGING)))
        // A primeira acaba com a segunda tocando: ela toca sozinha, com os tipos que já estão.
        assertNull("a segunda tocando sozinha", changed(ringing(id = 2)))
        assertNull("a segunda atendida", changed(answered(id = 2)))
        assertEquals(BASE_TYPES, changed(null))
    }

    @Test
    fun `a microphone refused during a call is not asked again at every change of the call`() {
        startWithoutACall()
        android.refusesMicrophone = true
        assertEquals(CALL_TYPES, changed(outgoing()))
        assertEquals(PHONE_CALL, android.accepted)
        // O mudo, a espera: a ligação muda, e o que ela pede não; o serviço pede de novo no próximo início (a tela de
        // chamada o inicia ao aparecer).
        assertNull(changed(outgoing(phase = CallPhase.ACTIVE)))
        assertNull(changed(outgoing(phase = CallPhase.ACTIVE).copy(muted = true)))
    }

    @Test
    fun `without the microphone permission the call types are phoneCall only`() {
        val withoutMicrophone = ForegroundReentry({ listOf(PHONE_CALL, BASE) }, { BASE_TYPES })
        android.enter(BASE_TYPES)
        assertNull(withoutMicrophone.onCall(null, android.accepted))
        assertNull(withoutMicrophone.onCall(ringing(), android.accepted))
        assertEquals(PHONE_CALL, android.enter(listOf(PHONE_CALL, BASE)))
        assertNull("atendida, o phoneCall já está lá", withoutMicrophone.onCall(answered(), android.accepted))
    }

    // O serviço começa (o onStartCommand) sem ligação, com os tipos de sempre.
    private fun startWithoutACall() {
        assertEquals(BASE, android.enter(BASE_TYPES))
        assertNull("sem ligação, os de sempre já estão lá", changed(null))
    }

    // A ligação muda para [call]: os tipos que o serviço pede, que o Android do teste aceita como aceitaria.
    private fun changed(call: CallUi?): List<Int>? = reentry.onCall(call, android.accepted)?.also { android.enter(it) }

    private fun ringing(id: Int = 1, autoAnswerSeconds: Int? = 0) =
        CallUi(id, "3001", "Cliente Teste", incoming = true, phase = CallPhase.RINGING, autoAnswerSeconds = autoAnswerSeconds)

    private fun answered(id: Int = 1, phase: CallPhase = CallPhase.CONNECTING, second: SecondUi? = null) =
        CallUi(id, "3001", "Cliente Teste", incoming = true, phase = phase, second = second)

    private fun outgoing(phase: CallPhase = CallPhase.DIALING) = CallUi(3, "2002", "", incoming = false, phase = phase)

    // O Android do teste: aceita o primeiro dos tipos pedidos, menos os com o microfone enquanto [refusesMicrophone]; o
    // aceito fica em [accepted] (nenhum aceito: fica o de antes, como no Android).
    private class FakeAndroid {
        var refusesMicrophone = false
        var accepted: Int? = null
            private set

        fun enter(types: List<Int>): Int? =
            types.firstOrNull { !refusesMicrophone || it and MICROPHONE == 0 }?.also { accepted = it }
    }

    private companion object {
        // Os tipos do Android 14+ (os números do ServiceInfo): specialUse, phoneCall e microphone.
        const val BASE = 0x40000000
        const val PHONE_CALL = BASE or 0x04
        const val MICROPHONE = 0x80
        const val WITH_MICROPHONE = PHONE_CALL or MICROPHONE
        val CALL_TYPES = listOf(WITH_MICROPHONE, PHONE_CALL, BASE)
        val BASE_TYPES = listOf(BASE)
        val SECOND_RINGING = SecondUi(2, "3001", "Cliente Teste", SecondKind.RINGING)
    }
}
