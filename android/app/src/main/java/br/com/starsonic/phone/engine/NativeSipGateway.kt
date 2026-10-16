package br.com.starsonic.phone.engine

import java.util.concurrent.Callable
import java.util.concurrent.ExecutionException
import java.util.concurrent.Executor
import java.util.concurrent.ExecutorService
import java.util.concurrent.Executors

/**
 * O [SipGateway] do app, pela ponte JNI de libstarsonic.so (src/main/cpp/jni_bridge.cpp).
 *
 * Threads:
 * - "starsonic-motor": a única que chama o motor. O pjsua guarda um registro de cada thread que o chama até
 *   o motor acabar, e o motor nunca pode ser destruído de dentro de um evento dele; aqui as duas coisas
 *   ficam garantidas, e as chamadas saem uma de cada vez, na ordem pedida.
 * - "starsonic-eventos": entrega os [EngineEvents]. A ponte só passa o aviso para cá e volta, então as
 *   threads do motor e do PJSIP nunca esperam o app, e quem recebe o aviso pode chamar o gateway (a thread do
 *   motor nunca espera a dos eventos).
 */
class NativeSipGateway : SipGateway {
    @Volatile
    private var engineThread: Thread? = null

    private val engineExecutor: ExecutorService = Executors.newSingleThreadExecutor { task ->
        Thread(task, "starsonic-motor").also {
            it.isDaemon = true
            engineThread = it
        }
    }

    private val eventExecutor: ExecutorService = Executors.newSingleThreadExecutor { task ->
        Thread(task, "starsonic-eventos").also { it.isDaemon = true }
    }

    // Só na thread do motor.
    private var engine = 0L

    // O sink do motor que está de pé (publicado para o stop() fechá-lo na hora, de qualquer thread).
    @Volatile
    private var sink: EngineSink? = null

    override fun start(userAgent: String, profileText: String, events: EngineEvents): Boolean = call {
        if (engine != 0L) return@call false
        val newSink = EngineSink(events, eventExecutor)
        val handle = nativeStart(userAgent, profileText, newSink)
        if (handle == 0L) {
            newSink.close()
            return@call false
        }
        engine = handle
        sink = newSink
        true
    }

    override fun stop() {
        sink?.close()
        post {
            val handle = engine
            engine = 0L
            sink?.close()
            sink = null
            if (handle != 0L) nativeStop(handle)
        }
    }

    override fun setAccount(address: String, transport: Transport, ramal: String, senha: String): Int = call {
        if (engine != 0L) nativeSetAccount(engine, address, transport == Transport.TCP, ramal, senha) else 0
    }

    override fun removeAccount() = post { if (engine != 0L) nativeRemoveAccount(engine) }

    override fun reregister() = post { if (engine != 0L) nativeReregister(engine) }

    override fun handleIpChange() = post { if (engine != 0L) nativeHandleIpChange(engine) }

    override fun makeCall(number: String): Int = call { if (engine != 0L) nativeMakeCall(engine, number) else -1 }

    override fun answer(id: Int) = post { if (engine != 0L) nativeAnswer(engine, id) }

    override fun reject(id: Int) = post { if (engine != 0L) nativeReject(engine, id) }

    override fun hangup(id: Int) = post { if (engine != 0L) nativeHangup(engine, id) }

    override fun setHold(id: Int, hold: Boolean) = post { if (engine != 0L) nativeSetHold(engine, id, hold) }

    override fun activate(id: Int) = post { if (engine != 0L) nativeActivate(engine, id) }

    override fun setMute(mute: Boolean) = post { if (engine != 0L) nativeSetMute(engine, mute) }

    override fun sendDtmf(id: Int, digits: String) = post { if (engine != 0L) nativeSendDtmf(engine, id, digits) }

    override fun transfer(id: Int, number: String) = post { if (engine != 0L) nativeTransfer(engine, id, number) }

    override fun transferAttended(id: Int, targetId: Int) =
        post { if (engine != 0L) nativeTransferAttended(engine, id, targetId) }

    override fun join(id: Int, otherId: Int) = post { if (engine != 0L) nativeJoin(engine, id, otherId) }

    override fun split(id: Int, otherId: Int) = post { if (engine != 0L) nativeSplit(engine, id, otherId) }

    override fun hasCall(): Boolean = call { engine != 0L && nativeHasCall(engine) }

    override fun callCount(): Int = call { if (engine != 0L) nativeCallCount(engine) else 0 }

    /** Põe o pedido na fila do motor e volta. */
    private fun post(task: () -> Unit) {
        engineExecutor.execute(Runnable { task() })
    }

    /** Roda na thread do motor e espera o resultado (na própria thread do motor, roda na hora). */
    private fun <T> call(task: () -> T): T {
        if (Thread.currentThread() === engineThread) return task()
        val result = engineExecutor.submit(Callable { task() })
        var interrupted = false
        try {
            while (true) {
                try {
                    return result.get()
                } catch (e: InterruptedException) {
                    interrupted = true   // a chamada ao motor segue até o fim; a interrupção fica para depois
                } catch (e: ExecutionException) {
                    throw e.cause ?: e
                }
            }
        } finally {
            if (interrupted) Thread.currentThread().interrupt()
        }
    }

    private external fun nativeStart(userAgent: String, profileText: String, sink: EngineSink): Long

    private external fun nativeStop(handle: Long)

    private external fun nativeSetAccount(handle: Long, address: String, tcp: Boolean, ramal: String, senha: String): Int

    private external fun nativeRemoveAccount(handle: Long)

    private external fun nativeReregister(handle: Long)

    private external fun nativeHandleIpChange(handle: Long)

    private external fun nativeMakeCall(handle: Long, number: String): Int

    private external fun nativeAnswer(handle: Long, callId: Int)

    private external fun nativeReject(handle: Long, callId: Int)

    private external fun nativeHangup(handle: Long, callId: Int)

    private external fun nativeSetHold(handle: Long, callId: Int, hold: Boolean)

    private external fun nativeActivate(handle: Long, callId: Int)

    private external fun nativeSetMute(handle: Long, mute: Boolean)

    private external fun nativeSendDtmf(handle: Long, callId: Int, digits: String)

    private external fun nativeTransfer(handle: Long, callId: Int, number: String)

    private external fun nativeTransferAttended(handle: Long, callId: Int, targetCallId: Int)

    private external fun nativeJoin(handle: Long, callId: Int, otherId: Int)

    private external fun nativeSplit(handle: Long, callId: Int, otherId: Int)

    private external fun nativeHasCall(handle: Long): Boolean

    private external fun nativeCallCount(handle: Long): Int

    init {
        System.loadLibrary("starsonic")   // a segunda carga não faz nada
    }
}

/**
 * Recebe os avisos da ponte JNI (das threads do motor e do PJSIP) e os passa às [events] na thread
 * [delivery], na ordem em que chegaram. A ponte chama estes métodos pelo nome (proguard-rules.pro os
 * mantém). Depois de [close], só as linhas de log ainda passam (o motor saindo escreve no log).
 */
class EngineSink(private val events: EngineEvents, private val delivery: Executor) {
    @Volatile
    private var closed = false

    fun close() {
        closed = true
    }

    fun onRegistration(code: Int, active: Boolean, accountId: Int) =
        deliver { events.onRegistration(code, active, accountId) }

    fun onIncomingCall(callId: Int, remoteUser: String, remoteName: String) =
        deliver { events.onIncomingCall(callId, remoteUser, remoteName) }

    fun onRejectedBusy(remoteUser: String, remoteName: String) = deliver { events.onRejectedBusy(remoteUser, remoteName) }

    fun onCallState(callId: Int, state: Int, code: Int) = deliver { events.onCallState(callId, state, code) }

    fun onTransfer(callId: Int, code: Int) = deliver { events.onTransfer(callId, code) }

    fun onLog(level: Int, line: String) {
        delivery.execute(Runnable { events.onLog(level, line) })
    }

    private fun deliver(event: () -> Unit) {
        delivery.execute(Runnable { if (!closed) event() })
    }
}
