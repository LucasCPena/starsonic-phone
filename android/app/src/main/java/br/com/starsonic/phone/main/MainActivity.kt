package br.com.starsonic.phone.main

import android.content.ActivityNotFoundException
import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.SystemBarStyle
import androidx.activity.compose.BackHandler
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.LineHeightStyle
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.em
import androidx.compose.ui.unit.sp
import androidx.core.splashscreen.SplashScreen.Companion.installSplashScreen
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.ViewModelProvider
import androidx.lifecycle.ViewModelStore
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import br.com.starsonic.phone.App
import br.com.starsonic.phone.BuildConfig
import br.com.starsonic.phone.about.AboutScreen
import br.com.starsonic.phone.about.SEND_DIAGNOSTICS
import br.com.starsonic.phone.call.CallActivity
import br.com.starsonic.phone.call.CallPhase
import br.com.starsonic.phone.contacts.ContactsScreen
import br.com.starsonic.phone.data.Account
import br.com.starsonic.phone.data.CallSettings
import br.com.starsonic.phone.engine.Transport
import br.com.starsonic.phone.login.LoginScreen
import br.com.starsonic.phone.login.LoginViewModel
import br.com.starsonic.phone.permissions.Grants
import br.com.starsonic.phone.permissions.Guide
import br.com.starsonic.phone.permissions.PermissionsScreen
import br.com.starsonic.phone.permissions.WarningBanner
import br.com.starsonic.phone.permissions.deviceGuide
import br.com.starsonic.phone.service.Refusal
import br.com.starsonic.phone.service.SipService
import br.com.starsonic.phone.settings.SettingsScreen
import br.com.starsonic.phone.ui.AccountCard
import br.com.starsonic.phone.ui.BottomNav
import br.com.starsonic.phone.ui.BrandHeader
import br.com.starsonic.phone.ui.HeaderChip
import br.com.starsonic.phone.ui.PlusJakartaSans
import br.com.starsonic.phone.ui.ScrollAwayHeader
import br.com.starsonic.phone.ui.Starsonic
import br.com.starsonic.phone.ui.StarsonicIcons
import br.com.starsonic.phone.ui.StarsonicTheme
import br.com.starsonic.phone.ui.Toast
import br.com.starsonic.phone.update.UpdateDialog
import br.com.starsonic.phone.update.UpdateNotification
import br.com.starsonic.phone.update.UpdateUi
import br.com.starsonic.phone.update.heldDuringCalls
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

/**
 * As telas do app (spec 4.1 e 7.1):
 * - Sem conta gravada, a tela Entrar. Depois de um Entrar que começou sem conta (o primeiro, ou o de depois de
 *   Sair), a tela Permissões, se falta alguma coisa; dela, a tela principal.
 * - Com conta, a tela principal no visual do Windows (spec 3): o cabeçalho da marca com o menu, o cartão da conta (a
 *   bolinha, o ramal e a linha do status) e as pílulas Não perturbe e Atender automático (spec 4 e 5); a faixa de
 *   avisos; as abas Teclado (com o Rediscar, spec 6), Recentes e Contatos (a agenda do celular, spec da 0.2, 7.5), com a
 *   volta para a ligação em andamento; e a navegação de baixo. A notificação de ligação perdida abre o Recentes
 *   ([ACTION_RECENTS]). O menu do cabeçalho tem Configurações e Sobre (spec 3.3). Com a letra grande numa tela pequena,
 *   o cabeçalho e as faixas sobem junto com a aba quando tomam a tela ([ScrollAwayHeader], F3).
 * - Configurações (spec 8): a Conta, com o Editar conta e o Sair da conta; as Ligações (o bipe no fim da ligação, o
 *   Atender automático e o tempo dele); e o Celular, com Permissões e bateria, que abre a tela Permissões (que daqui
 *   não segue sozinha, e o voltar volta às Configurações).
 * - Editar conta: a tela Entrar com servidor, protocolo e ramal preenchidos e a senha vazia (nunca a tela
 *   Permissões depois). Registrou: a conta nova é gravada e o serviço começa de novo, porque ele só troca a conta que
 *   segura quando começa (fica com a nova, que já está no motor, sem outro REGISTER). Falhou: a conta anterior volta.
 *   O voltar do Android volta para onde ele abriu (as Configurações, ou a tela principal).
 * - Sair da conta, depois da confirmação: a ligação de agora acaba, o serviço para (a conta sai do motor), a conta e
 *   a senha saem do celular e a tela Entrar volta, vazia. Os Recentes e as configurações de ligação ficam.
 * - Sobre, com os links, a licença e o "Enviar diagnóstico".
 * - O servidor recusou a senha da conta gravada (401, 403 ou 407 fora de uma tentativa da tela Entrar;
 *   [br.com.starsonic.phone.service.Connection.refusal]): com o app na frente, o Editar abre com "Ramal ou senha
 *   incorretos." (com uma ligação em andamento, depois que ela acaba; com o Editar já aberto, o aviso aparece nele);
 *   com o app em segundo plano, a notificação fixa já mostra o aviso, e a próxima abertura vai para o Editar. Uma vez
 *   por recusa: quem sai do Editar não volta para ele até uma recusa nova.
 * - A atualização (spec 7.6): cada abertura (onStart) confere o canal, se a última verificação tem mais de 24 h
 *   ([br.com.starsonic.phone.update.Updater]), e o aviso aparece sobre a tela principal (UpdateDialog); a confirmação
 *   do instalador do Android abre daqui, com o app na frente e sem uma ligação (com uma, quando ela acaba).
 *
 * A conta gravada é lida fora da thread principal (Keystore e disco), com a tela de abertura na frente. Com a
 * conta, a activity inicia o [SipService] ao abrir e a cada volta ao app (com a conta já no motor, ele não
 * registra de novo, a não ser que a última renovação tenha falhado numa falha que o motor só repetiria mais tarde:
 * aí ela vai na hora); o fim do Entrar e o do Editar também o iniciam. O modelo da tela Entrar de agora fica em
 * [LoginSessions] (sobrevive às recriações) e sai com a tela.
 */
class MainActivity : ComponentActivity() {
    private val app: App
        get() = application as App

    /** As telas. */
    private enum class Screen { ENTRAR, PERMISSIONS, MAIN, EDIT, ABOUT, SETTINGS }

    // A tela de agora (null enquanto o app lê a conta gravada: a tela de abertura fica na frente). Só na thread
    // principal; sobrevive às recriações.
    private var screen by mutableStateOf<Screen?>(null)

    // O protocolo da tela Entrar de uma conta nova (o padrão do perfil: lê o disco e o núcleo), lido fora da thread
    // principal; null até lá.
    private var newAccountTransport by mutableStateOf<Transport?>(null)

    // O aviso com que o Editar abre (a senha recusada pelo servidor); "" no Editar das Configurações.
    private var editMessage = ""

    // Para onde o voltar do Android leva do Editar: a tela de onde ele abriu (as Configurações ou a principal).
    private var editReturn = Screen.MAIN

    // Para onde a tela Permissões leva (o voltar, o Voltar e o Continuar): a principal, depois do Entrar; as
    // Configurações, de onde ela abriu.
    private var permissionsReturn = Screen.MAIN

    // Há conta gravada (a de quando o app abriu, ou a do Entrar). Só na thread principal.
    private var signedIn = false

    // Cada volta ao app (ON_RESUME): a faixa de avisos e a tela Permissões conferem de novo as permissões.
    private var resumes by mutableIntStateOf(0)

    // A aba da tela principal (a notificação de perdida pede o Recentes).
    private var tab by mutableIntStateOf(TAB_KEYPAD)

    private lateinit var logins: LoginSessions

    override fun onCreate(savedInstanceState: Bundle?) {
        installSplashScreen().setKeepOnScreenCondition { screen == null }
        // A faixa é azul nos dois modos: ícones claros na barra de status, que fica por cima dela.
        enableEdgeToEdge(statusBarStyle = SystemBarStyle.dark(android.graphics.Color.TRANSPARENT))
        super.onCreate(savedInstanceState)
        logins = ViewModelProvider(this)[LoginSessions::class.java]
        // A aba e a tela sobrevivem a uma recriação (girar não acontece: retrato; mas o tema e o idioma, sim).
        tab = savedInstanceState?.getInt(STATE_TAB, TAB_KEYPAD) ?: if (intent?.action == ACTION_RECENTS) TAB_RECENTS else TAB_KEYPAD
        val restored = savedInstanceState?.getString(STATE_SCREEN)?.let { name -> Screen.entries.firstOrNull { it.name == name } }
        editMessage = savedInstanceState?.getString(STATE_EDIT_MESSAGE).orEmpty()
        editReturn = if (savedInstanceState?.getString(STATE_EDIT_RETURN) == Screen.SETTINGS.name) Screen.SETTINGS else Screen.MAIN
        permissionsReturn =
            if (savedInstanceState?.getString(STATE_PERMISSIONS_RETURN) == Screen.SETTINGS.name) Screen.SETTINGS else Screen.MAIN
        lifecycleScope.launch {
            val (account, transport) = withContext(Dispatchers.IO) {
                app.contactDialProfile()   // o perfil da regra dos números dos contatos, lido aqui, e não num toque
                val account = app.store.load()
                account to (if (account == null) app.defaultTransport else account.transport)
            }
            if (account != null) {
                signedIn = true
                SipService.start(this@MainActivity)
                screen = when (restored) {
                    Screen.PERMISSIONS, Screen.EDIT, Screen.ABOUT, Screen.SETTINGS -> restored
                    Screen.ENTRAR -> {
                        // A recriação chegou entre a gravação da conta e o fim da tela Entrar: o fim vale aqui.
                        app.calls.onLogin()
                        endLogin()
                        Screen.MAIN
                    }
                    else -> Screen.MAIN
                }
            } else {
                // O motor sobe enquanto a pessoa preenche a tela Entrar (uma vez por processo).
                launch(Dispatchers.IO) { app.connection.ensureStarted() }
                newAccountTransport = transport
                if (restored != Screen.ENTRAR) endLogin()   // um Editar de uma conta que já não existe
                screen = Screen.ENTRAR
            }
        }
        // A senha recusada pelo servidor, só com o app na frente: na volta ao app, a recusa que chegou enquanto ele
        // estava em segundo plano; com uma ligação, quando ela acaba.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                combine(app.connection.refusal, snapshotFlow { screen }, app.calls.state) { refusal, shown, call ->
                    Triple(refusal, shown, call != null)
                }.collect { (refusal, shown, inCall) ->
                    if (refusal != null && shown != null) onRefusal(refusal, shown, inCall)
                }
            }
        }
        // A confirmação do instalador do Android (a atualização baixada e conferida), aberta com o app na frente e sem uma
        // ligação: por cima dela, o "Atualizar" do Android a derrubaria (spec 7.6.3); quando ela acaba, a confirmação vem.
        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                heldDuringCalls(app.updateInstaller.confirmation, app.calls.state.map { it != null }).collect { confirm ->
                    if (confirm != null) openInstaller(confirm)
                }
            }
        }
        setContent {
            StarsonicTheme {
                Surface(Modifier.fillMaxSize()) {
                    BackHandler(enabled = screen in INNER_SCREENS) { back() }
                    when (screen) {
                        null -> {}   // a tela de abertura está na frente
                        Screen.ENTRAR -> EntrarScreen()
                        Screen.PERMISSIONS -> PermissionsScreen(
                            resumes,
                            deviceGuide(),
                            continuesAlone = permissionsReturn == Screen.MAIN,
                            onContinue = ::back,
                        )
                        Screen.MAIN -> MainScreen()
                        Screen.EDIT -> EditScreen()
                        Screen.ABOUT -> AboutScreen(BuildConfig.VERSION_NAME, onBack = ::back, onSendDiagnostics = ::sendDiagnostics)
                        Screen.SETTINGS -> {
                            val status by app.status.collectAsState()
                            // A conta gravada, para o "servidor · protocolo": lida fora da thread principal (Keystore e disco).
                            val account by produceState<Account?>(null) { value = withContext(Dispatchers.IO) { app.store.load() } }
                            SettingsScreen(
                                status,
                                account,
                                app.callSettings,
                                onBack = ::back,
                                onEdit = { openEdit("") },
                                onSignOut = ::signOut,
                                onPermissions = ::openPermissions,
                                note = app::note,
                            )
                        }
                    }
                }
            }
        }
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        if (intent.action == ACTION_RECENTS) tab = TAB_RECENTS
    }

    override fun onSaveInstanceState(outState: Bundle) {
        super.onSaveInstanceState(outState)
        outState.putInt(STATE_TAB, tab)
        screen?.let { outState.putString(STATE_SCREEN, it.name) }
        outState.putString(STATE_EDIT_MESSAGE, editMessage)
        outState.putString(STATE_EDIT_RETURN, editReturn.name)
        outState.putString(STATE_PERMISSIONS_RETURN, permissionsReturn.name)
    }

    override fun onStart() {
        super.onStart()
        // A cada volta ao app com a conta gravada: se o Android fechou o serviço, ele volta; e um registro que falhou
        // numa falha que o motor só repetiria mais tarde (até 300 s) é renovado na hora (Connection.adopt).
        if (signedIn) SipService.start(this)
        // Ao abrir: o canal de atualização, se a última verificação tem mais de 24 h (fora da thread principal).
        app.updater.onScreen(true)
        app.updater.checkSoon()
    }

    override fun onStop() {
        app.updater.onScreen(false)
        super.onStop()
    }

    override fun onResume() {
        super.onResume()
        resumes++
    }

    override fun onDestroy() {
        super.onDestroy()
        if (isFinishing) app.connection.loginEvents = null
    }

    /** A tela Entrar de uma conta nova; no fim, o serviço fica com a conta que ela registrou. */
    @Composable
    private fun EntrarScreen() {
        val transport = newAccountTransport
        if (transport == null) {
            // Depois de Sair: o protocolo padrão do perfil, lido fora da thread principal.
            LaunchedEffect(Unit) { newAccountTransport = withContext(Dispatchers.IO) { app.defaultTransport } }
            return
        }
        val model = remember {
            loginModel { LoginViewModel(app.core, app.gateway, app.store, app.clock, previous = null, defaultTransport = transport, log = app::warn) }
        }
        Login(model) {
            signedIn = true
            // Sem o serviço, a conta não fica registrada; ele começa na próxima volta ao app.
            if (!SipService.start(this)) app.gateway.removeAccount()
            app.calls.onLogin()   // depois de um Sair, as ligações voltam a valer
            endLogin()
            permissionsReturn = Screen.MAIN
            screen = if (needsPermissions()) Screen.PERMISSIONS else Screen.MAIN
        }
    }

    /**
     * O Editar: a tela Entrar com a conta gravada (lida fora da thread principal) e o aviso [editMessage]. Gravada a
     * conta nova, o serviço começa de novo para segurar a conta nova ([editModel]).
     */
    @Composable
    private fun EditScreen() {
        // O modelo que já existe (uma recriação da activity) volta a ouvir os resultados do registro.
        var model by remember { mutableStateOf(logins.current?.let { current -> loginModel { current } }) }
        val shown = model
        if (shown == null) {
            LaunchedEffect(Unit) {
                val saved = withContext(Dispatchers.IO) { app.store.load() }
                if (saved == null) {
                    // A conta gravada já não abre (a chave do Keystore sumiu): a tela Entrar de uma conta nova.
                    signedIn = false
                    screen = Screen.ENTRAR
                } else {
                    model = loginModel { editModel(saved) }
                }
            }
            return
        }
        // O serviço já começou quando a conta nova foi gravada (onSaved, em editModel).
        Login(shown) {
            endLogin()
            screen = Screen.MAIN
        }
    }

    /** A tela Entrar com o modelo [model]; [onDone] quando a conta registrou e foi gravada. */
    @Composable
    private fun Login(model: LoginViewModel, onDone: () -> Unit) {
        val state by model.state.collectAsState()
        LaunchedEffect(state.done) {
            if (state.done) onDone()
        }
        LoginScreen(model)
    }

    @Composable
    private fun MainScreen() {
        val status by app.status.collectAsState()
        val ramal by app.connection.ramal.collectAsState()
        val settings by app.callSettings.settings.collectAsState()
        val banner = remember(resumes) { Grants.read(this@MainActivity).banner }
        val call by app.calls.state.collectAsState()
        val message by app.calls.endMessage.collectAsState()
        val update by app.updater.ui.collectAsState()
        val (redial, redialName) = rememberRedial(app.recents, app.contacts)
        var menuOpen by remember { mutableStateOf(false) }
        Box(Modifier.fillMaxSize()) {
            Column(Modifier.fillMaxSize()) {
                // Com a letra grande numa tela pequena, o cabeçalho e as faixas sobem junto com a aba (F3): a aba e a
                // navegação de baixo nunca ficam sem lugar.
                ScrollAwayHeader(
                    modifier = Modifier.weight(1f).fillMaxWidth(),
                    header = {
                        Column(Modifier.fillMaxWidth()) {
                            BrandHeader(
                                menu = {
                                    HeaderMenu(
                                        expanded = menuOpen,
                                        onExpand = { menuOpen = true },
                                        onDismiss = { menuOpen = false },
                                        onSettings = { screen = Screen.SETTINGS },
                                        onAbout = { screen = Screen.ABOUT },
                                    )
                                },
                                modifier = Modifier.testTag("cabecalho"),
                            ) {
                                AccountCard(status, ramal)
                                CallToggles(settings)
                            }
                            if (banner != null) WarningBanner(banner)
                            // A recebida que ainda toca tem a notificação dela; a faixa é para a ligação atendida ou feita.
                            if (call?.let { it.phase != CallPhase.RINGING } == true) ReturnToCall()
                        }
                    },
                ) {
                    Box(Modifier.fillMaxSize()) {
                        when (tab) {
                            TAB_RECENTS -> RecentsScreen(app.recents, app.contacts, onDial = { dial(it) })
                            TAB_CONTACTS -> ContactsScreen(app.contacts, onCall = { dialContact(it) })
                            else -> DialerScreen(::dial, app.contacts::search, app.dialRule, redial, redialName)
                        }
                        // O aviso de discar sem registro (ou de uma feita que não completou), por cima das duas abas.
                        CallMessage(message, Modifier.align(Alignment.BottomCenter))
                    }
                }
                BottomNav(selected = tab, onSelect = { tab = it }, modifier = Modifier.testTag("navegacao"))
            }
            MenuScrim(menuOpen)
        }
        // O aviso de atualização (versão nova, download, ligação em andamento, falha). Com o aviso da versão nova na
        // tela, a notificação dela sai.
        update?.let { shown ->
            if (shown is UpdateUi.Offer) LaunchedEffect(shown) { UpdateNotification.cancel(this@MainActivity) }
            UpdateDialog(shown, onUpdate = app.updater::accept, onDismiss = app.updater::dismiss)
        }
    }

    // As pílulas do cabeçalho (spec 4 e 5): o Não perturbe e o Atender automático trocam as configurações de ligação,
    // que o CallManager lê a cada ligação, e ficam anotadas no log de diagnóstico. Com a letra grande, a segunda desce.
    @Composable
    private fun CallToggles(settings: CallSettings) {
        FlowRow(horizontalArrangement = Arrangement.spacedBy(8.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) {
            HeaderChip(DO_NOT_DISTURB, StarsonicIcons.DoNotDisturb, settings.doNotDisturb, "nao-perturbe") {
                app.callSettings.update { it.copy(doNotDisturb = !it.doNotDisturb) }
                app.note("$DO_NOT_DISTURB ${onOrOff(app.callSettings.settings.value.doNotDisturb)}")
            }
            HeaderChip(AUTO_ANSWER, StarsonicIcons.Incoming, settings.autoAnswer, "atender-auto") {
                app.callSettings.update { it.copy(autoAnswer = !it.autoAnswer) }
                app.note("$AUTO_ANSWER ${onOrOff(app.callSettings.settings.value.autoAnswer)}")
            }
        }
    }

    // O aviso das ligações (spec 7.4 e 11.1), por 2 s: o aviso do Windows, no fim da área das abas, por cima do conteúdo;
    // aparece e some sem empurrar o teclado e a lista embaixo do dedo.
    @Composable
    private fun CallMessage(message: String, modifier: Modifier) {
        Toast(message, tag = "aviso-ligacao", modifier = modifier.padding(horizontal = 16.dp, vertical = 14.dp))
    }

    // A faixa da ligação em andamento, embaixo do cabeçalho: ciano (a ação), com o fone e a seta; tocar volta à tela de
    // chamada.
    @Composable
    private fun ReturnToCall() {
        Row(
            Modifier
                .fillMaxWidth()
                .background(Starsonic.Cyan)
                .clickable(role = Role.Button) { startActivity(CallActivity.intent(this)) }
                .heightIn(min = 48.dp)
                .padding(horizontal = 18.dp, vertical = 10.dp)
                .testTag("voltar-ligacao"),
            horizontalArrangement = Arrangement.spacedBy(10.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(StarsonicIcons.Phone, contentDescription = null, tint = Starsonic.OnCyan, modifier = Modifier.size(18.dp))
            Text(RETURN_TO_CALL, color = Starsonic.OnCyan, style = BarText, modifier = Modifier.weight(1f))
            Icon(StarsonicIcons.ArrowRight, contentDescription = null, tint = Starsonic.OnCyan, modifier = Modifier.size(16.dp))
        }
    }

    // Liga (do Teclado, do Rediscar ou do Recentes) e abre a tela de chamada; sem registro, o aviso aparece por cima das
    // abas.
    private fun dial(number: String): Boolean {
        val dialed = app.calls.dial(number)
        if (dialed) startActivity(CallActivity.intent(this))
        return dialed
    }

    // Liga para o número de um contato (a aba Contatos: a regra dos números dos contatos) como o [dial].
    private fun dialContact(number: String) {
        if (app.calls.dialContact(number)) startActivity(CallActivity.intent(this))
    }

    // O Editar, com o aviso [message] ("" no das Configurações); um modelo novo, com a conta gravada de agora. O voltar
    // dele leva de novo às Configurações, se abriu de lá.
    private fun openEdit(message: String) {
        endLogin()
        editMessage = message
        editReturn = if (screen == Screen.SETTINGS) Screen.SETTINGS else Screen.MAIN
        screen = Screen.EDIT
    }

    // A tela Permissões das Configurações (Permissões e bateria): ela não segue sozinha, e sair dela volta às
    // Configurações.
    private fun openPermissions() {
        permissionsReturn = Screen.SETTINGS
        screen = Screen.PERMISSIONS
    }

    // O voltar (o do Android e o da barra escura): do Editar, para onde ele abriu (sair no meio de uma tentativa a
    // desfaz); da tela Permissões (também o Continuar), para onde ela leva; das Configurações e do Sobre, a tela
    // principal.
    private fun back() {
        screen = when (screen) {
            Screen.EDIT -> {
                endLogin()
                editReturn
            }
            Screen.PERMISSIONS -> permissionsReturn
            else -> Screen.MAIN
        }
    }

    // Sair da conta (spec 7.1.6), depois da confirmação. Tudo aqui volta na hora, na thread principal: nenhuma volta
    // ao app (que inicia o serviço com a conta gravada) passa no meio.
    private fun signOut() {
        app.note("Sair da conta")
        app.calls.onLogout()          // a ligação de agora acaba; os avisos do motor ficam de fora até o próximo Entrar
        SipService.stop(this)         // a conta sai do motor (o release do serviço); o motor fica de pé
        app.store.clear()             // a conta e a senha (o disco, logo depois, fora da thread principal)
        signedIn = false
        endLogin()
        screen = Screen.ENTRAR        // os Recentes ficam; a tela Permissões vem depois do próximo Entrar
    }

    // A senha recusada pelo servidor (com o app na frente): o Editar com o aviso, uma vez por recusa.
    private fun onRefusal(refusal: Refusal, shown: Screen, inCall: Boolean) {
        when (shown) {
            Screen.MAIN, Screen.ABOUT, Screen.SETTINGS -> {
                if (inCall) return   // com uma ligação em andamento, o Editar espera ela acabar
                app.connection.refusalSeen(refusal)
                app.note("o servidor recusou a senha: a tela Entrar (Editar)")
                openEdit(refusal.message)
            }
            Screen.EDIT -> {
                // O Editar já aberto ganha o aviso (o modelo ainda vai nascer, ou já está aqui).
                val model = logins.current
                if (model != null) model.showMessage(refusal.message) else editMessage = refusal.message
                app.connection.refusalSeen(refusal)
            }
            // A tela Entrar de uma conta nova não tem conta gravada para recusar.
            Screen.ENTRAR -> app.connection.refusalSeen(refusal)
            // Depois da tela Permissões, na tela principal.
            Screen.PERMISSIONS -> Unit
        }
    }

    // O "Enviar diagnóstico": o arquivo do log é lido fora da thread principal, e o Android mostra para onde mandar.
    private fun sendDiagnostics() {
        lifecycleScope.launch {
            val send = withContext(Dispatchers.IO) { app.diagnostics.shareIntent(app) }
            try {
                startActivity(Intent.createChooser(send, SEND_DIAGNOSTICS))
            } catch (e: ActivityNotFoundException) {
                // Nenhum app para receber: nada a fazer.
            }
        }
    }

    // A confirmação do Android para instalar a versão nova (a pessoa toca em "Atualizar" lá), se outra tela do app não a
    // pegou antes; sai da fila mesmo se não abrir.
    private fun openInstaller(confirm: Intent) {
        if (!app.updateInstaller.takeConfirmation(confirm)) return
        try {
            startActivity(confirm)
        } catch (e: ActivityNotFoundException) {
            app.note("atualização: a confirmação do Android não abriu")
        } catch (e: SecurityException) {
            app.note("atualização: a confirmação do Android não abriu")
        }
    }

    // A tela Permissões aparece se falta alguma permissão, ou num celular com o passo a passo do fabricante.
    private fun needsPermissions(): Boolean = Grants.read(this).missing.isNotEmpty() || deviceGuide() != Guide.GENERIC

    // O modelo do Editar, com a conta gravada [saved] e o aviso de agora. Gravada a conta nova, o serviço começa de novo
    // (obrigatório: ele só troca a conta que segura quando começa, e fica com a nova, que já está no motor), mesmo que a
    // pessoa já tenha saído da tela entre a resposta do servidor e o fim da gravação.
    private fun editModel(saved: Account): LoginViewModel {
        val process = app   // o modelo sobrevive à activity: ele guarda o App, nunca a activity
        return LoginViewModel(
            process.core, process.gateway, process.store, process.clock, previous = saved,
            defaultTransport = saved.transport, message = editMessage, log = process::warn,
            onSaved = {
                process.note("Editar conta: a conta nova foi gravada")
                SipService.start(process)
            },
        )
    }

    // O modelo da tela Entrar de agora (o que já existe, ou um novo), ligado aos resultados do registro.
    private fun loginModel(create: () -> LoginViewModel): LoginViewModel {
        val model = logins.model(create)
        app.connection.loginEvents = model::onRegistration
        return model
    }

    // A tela Entrar de agora acabou (entrou, saiu do Editar, Sair): o modelo dela sai, e uma tentativa no meio é
    // desfeita (fora da thread principal).
    private fun endLogin() {
        app.connection.loginEvents = null
        logins.end()
    }

    companion object {
        /** A notificação de ligação perdida: abre o app no Recentes. */
        const val ACTION_RECENTS = "br.com.starsonic.phone.action.RECENTES"

        private const val STATE_TAB = "aba"
        private const val STATE_SCREEN = "tela"
        private const val STATE_EDIT_MESSAGE = "aviso-editar"
        private const val STATE_EDIT_RETURN = "volta-editar"
        private const val STATE_PERMISSIONS_RETURN = "volta-permissoes"

        // As telas em que o voltar do Android fica no app ([back]).
        private val INNER_SCREENS = setOf(Screen.EDIT, Screen.ABOUT, Screen.SETTINGS, Screen.PERMISSIONS)

        // As abas, na ordem da navegação de baixo (BottomNav).
        private const val TAB_KEYPAD = 0
        private const val TAB_RECENTS = 1
        private const val TAB_CONTACTS = 2
        private const val RETURN_TO_CALL = "Ligação em andamento. Toque para voltar."
        private const val DO_NOT_DISTURB = "Não perturbe"
        private const val AUTO_ANSWER = "Atender automático"

        // O que o log de diagnóstico anota quando a pessoa toca numa pílula.
        private fun onOrOff(on: Boolean): String = if (on) "ligado" else "desligado"

        // O texto da faixa da ligação em andamento.
        private val BarText = TextStyle(
            fontFamily = PlusJakartaSans,
            fontSize = 13.5.sp,
            fontWeight = FontWeight.Bold,
            lineHeight = 1.35.em,
            lineHeightStyle = LineHeightStyle(LineHeightStyle.Alignment.Center, LineHeightStyle.Trim.None),
        )
    }
}

/**
 * O modelo da tela Entrar de agora (a de uma conta nova ou a do Editar), num ViewModelStore só dele: sobrevive às
 * recriações da activity e sai com a tela ([end]), e aí o onCleared do modelo desfaz uma tentativa no meio, como no
 * Windows. Só na thread principal.
 */
class LoginSessions : ViewModel() {
    private var store = ViewModelStore()

    /** O modelo da tela Entrar aberta (null: nenhuma). */
    var current: LoginViewModel? = null
        private set

    /** O modelo de agora, ou um novo ([create]). */
    fun model(create: () -> LoginViewModel): LoginViewModel =
        current ?: ViewModelProvider(store, Factory(create))[LoginViewModel::class.java].also { current = it }

    /** A tela acabou: o modelo dela sai. */
    fun end() {
        current = null
        store.clear()
        store = ViewModelStore()
    }

    override fun onCleared() {
        store.clear()
    }

    private class Factory(private val build: () -> LoginViewModel) : ViewModelProvider.Factory {
        @Suppress("UNCHECKED_CAST")
        override fun <T : ViewModel> create(modelClass: Class<T>): T = build() as T
    }
}
