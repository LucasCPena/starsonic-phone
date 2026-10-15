package br.com.starsonic.phone.update

import java.io.Closeable
import java.io.IOException
import java.io.OutputStream
import java.net.InetAddress
import java.net.ServerSocket
import java.net.Socket
import java.util.concurrent.CopyOnWriteArrayList
import kotlin.concurrent.thread
import org.junit.After
import org.junit.Assert.assertArrayEquals
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * A rede de verdade do atualizador (HttpURLConnection) contra servidores HTTP locais: o redirecionamento para outro
 * servidor (como o do GitHub para o armazenamento dos assets), o User-Agent, os erros sem o endereço e os limites.
 */
class HttpUpdateNetworkTest {
    private val servers = mutableListOf<TestServer>()
    private val network = HttpUpdateNetwork(AGENT)

    @After
    fun stopServers() {
        servers.forEach { it.close() }
    }

    private fun server(vararg routes: Pair<String, (OutputStream) -> Unit>): TestServer = TestServer(routes.toMap()).also { servers += it }

    @Test
    fun `the channel comes after a redirect to another server, with the app User-Agent`() {
        val assets = server("/versao-android.json" to reply(200, JSON.toByteArray()))
        val releases = server("/canal-android/versao-android.json" to reply(302, location = "${assets.base}/versao-android.json"))
        assertEquals(JSON, network.text("${releases.base}/canal-android/versao-android.json", 1_000_000))
        assertEquals(listOf(AGENT), releases.agents)
        assertEquals(listOf(AGENT), assets.agents)
    }

    @Test
    fun `an HTTP error is a failure without the address`() {
        val base = server("/outro" to reply(200, JSON.toByteArray())).base
        val error = runCatching { network.text("$base/versao-android.json", 1_000_000) }.exceptionOrNull()
        assertTrue("$error", error is IOException)
        assertEquals("HTTP 404", error?.message)
        val download = runCatching { network.open("$base/StarsonicPhone-android-0.1.1.apk") }.exceptionOrNull()
        assertTrue("$download", download is IOException)
        assertEquals("HTTP 404", download?.message)
    }

    @Test
    fun `a channel bigger than the limit is a failure`() {
        val base = server("/versao-android.json" to reply(200, ByteArray(2_000) { 'a'.code.toByte() })).base
        assertTrue(runCatching { network.text("$base/versao-android.json", 1_000) }.exceptionOrNull() is IOException)
        assertEquals("a".repeat(2_000), network.text("$base/versao-android.json", 2_000))
    }

    @Test
    fun `the APK comes whole after the redirect`() {
        val apk = ByteArray(300_000) { (it * 7).toByte() }
        val assets = server("/a.apk" to reply(200, apk))
        val releases = server("/android-v0.1.1/StarsonicPhone-android-0.1.1.apk" to reply(302, location = "${assets.base}/a.apk"))
        val received = network.open("${releases.base}/android-v0.1.1/StarsonicPhone-android-0.1.1.apk").use { it.readBytes() }
        assertArrayEquals(apk, received)
    }

    @Test
    fun `a download cut by the server never comes whole`() {
        // O servidor promete 64 KiB, manda 4 KiB e fecha a conexão: a leitura falha ou acaba antes da hora (e aí o
        // SHA-256 não confere: UpdaterTest).
        val base = server("/a.apk" to reply(200, ByteArray(4_096), length = 65_536)).base
        val received = try {
            network.open("$base/a.apk").use { it.readBytes() }
        } catch (e: IOException) {
            null
        }
        assertFalse("${received?.size} bytes", received != null && received.size >= 65_536)
    }

    // Uma resposta HTTP/1.1 com [body] (o Content-Length diz [length]), e a conexão fecha depois dela.
    private fun reply(status: Int, body: ByteArray = ByteArray(0), location: String? = null, length: Int = body.size): (OutputStream) -> Unit =
        { out ->
            val head = buildString {
                append("HTTP/1.1 $status ${if (status == 302) "Found" else "Status"}\r\n")
                if (location != null) append("Location: $location\r\n")
                append("Content-Length: $length\r\n")
                append("Connection: close\r\n\r\n")
            }
            out.write(head.toByteArray(Charsets.ISO_8859_1))
            out.write(body)
        }

    /**
     * Um servidor HTTP mínimo em 127.0.0.1, numa porta livre: um pedido por conexão, a resposta pelo caminho (404 para os
     * outros), e o User-Agent de cada pedido em [agents].
     */
    private class TestServer(private val routes: Map<String, (OutputStream) -> Unit>) : Closeable {
        private val socket = ServerSocket(0, 50, InetAddress.getLoopbackAddress())
        val base = "http://127.0.0.1:${socket.localPort}"
        val agents = CopyOnWriteArrayList<String>()

        init {
            thread(isDaemon = true, name = "servidor-http-de-teste") {
                while (true) {
                    val client = try {
                        socket.accept()
                    } catch (e: IOException) {
                        break
                    }
                    try {
                        client.use(::serve)
                    } catch (e: IOException) {
                        // O cliente desistiu no meio: o próximo pedido.
                    }
                }
            }
        }

        private fun serve(client: Socket) {
            val request = client.getInputStream().bufferedReader(Charsets.ISO_8859_1)
            val path = request.readLine()?.split(' ')?.getOrNull(1) ?: return
            while (true) {
                val header = request.readLine() ?: break
                if (header.isEmpty()) break
                if (header.startsWith("User-Agent:", ignoreCase = true)) agents += header.substringAfter(':').trim()
            }
            val out = client.getOutputStream()
            (routes[path] ?: { it.write("HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".toByteArray()) })(out)
            out.flush()
        }

        override fun close() {
            socket.close()
        }
    }

    private companion object {
        const val AGENT = "Starsonic Phone Android/0.1.0"
        const val JSON = """{"versao":"0.1.1","notas":"Correção do áudio"}"""
    }
}
