// Ponte JNI do app Android: liga o Kotlin ao núcleo e ao motor de ligações em C++.
// - br.com.starsonic.phone.Native: as funções do núcleo que as telas usam (validar o servidor e o ramal,
//   os textos do registro e do fim da ligação, o número a discar, o número dos contatos do aparelho e, do
//   perfil, o protocolo padrão, o ddi e o prefixo externo) e as do atualizador (o versao-android.json e a
//   ordem das versões).
// - br.com.starsonic.phone.core.LoginFlowHandle: o LoginFlow do núcleo (a espera da tela Entrar).
// - br.com.starsonic.phone.engine.NativeSipGateway: o SipEngine. O gateway chama o motor sempre da mesma
//   thread dele; os avisos do motor voltam por um EngineSink (ver JniListener).
//
// Texto: o Java guarda as String em UTF-16 e, no Android, o wchar_t tem 32 bits (uma unidade por
// caractere, como o núcleo espera). As conversões abaixo juntam e separam os pares substitutos; um
// substituto solto vira U+FFFD, como no WideToUtf8 do núcleo. O texto em UTF-8 do motor passa pelo
// Utf8ToWide do núcleo (nunca pelo NewStringUTF, que quebra com caracteres de 4 bytes no CheckJNI).
#include <jni.h>
#include <pthread.h>

#include <pj/os.h>

#include <cstdint>
#include <memory>
#include <new>
#include <string>
#include <type_traits>
#include <vector>

#include "AccountPolicy.h"
#include "CallMessages.h"
#include "LoginFlow.h"
#include "Profile.h"
#include "RegistrationErrors.h"
#include "SipEngine.h"
#include "Text.h"
#include "UpdateManifest.h"

namespace {

// A JVM do app, guardada no JNI_OnLoad.
JavaVM* g_vm = nullptr;

// As threads que a ponte prende à JVM (a fila de eventos do motor e as do PJSIP que escrevem no log)
// guardam nesta chave o JNIEnv; o destrutor dela as solta quando acabam.
pthread_key_t g_attachedThreadKey;
bool g_attachedThreadKeyReady = false;

const char kEventThreadName[] = "starsonic-motor-eventos";
const char kLogThreadName[] = "starsonic-pjsip";

// O ART derruba o processo quando uma thread presa à JVM acaba sem se soltar.
void DetachAttachedThread(void* /* env */) {
    if (g_vm != nullptr) g_vm->DetachCurrentThread();
}

// O JNIEnv desta thread. Uma thread nativa é presa à JVM na primeira vez e fica presa até acabar (sem
// prender e soltar a cada aviso). nullptr se não deu.
JNIEnv* AttachedEnv(const char* threadName) {
    if (g_vm == nullptr) return nullptr;
    JNIEnv* env = nullptr;
    const jint got = g_vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6);
    if (got == JNI_OK) return env;
    if (got != JNI_EDETACHED || !g_attachedThreadKeyReady) return nullptr;
    JavaVMAttachArgs args;
    args.version = JNI_VERSION_1_6;
    args.name = const_cast<char*>(threadName);
    args.group = nullptr;
#ifdef __ANDROID__
    const jint attached = g_vm->AttachCurrentThread(&env, &args);
#else  // o jni.h do JDK (o teste da ponte no Linux) declara void**
    const jint attached = g_vm->AttachCurrentThread(reinterpret_cast<void**>(&env), &args);
#endif
    if (attached != JNI_OK) return nullptr;
    if (pthread_setspecific(g_attachedThreadKey, env) != 0) {
        g_vm->DetachCurrentThread();
        return nullptr;
    }
    return env;
}

// O PJSIP usa o JNI (o áudio Oboe, ao subir e ao sair) sem conferir exceções: nenhuma volta ao Kotlin
// nem fica pendente para a próxima chamada JNI.
void DropPendingException(JNIEnv* env) {
    if (env->ExceptionCheck()) {
        env->ExceptionDescribe();
        env->ExceptionClear();
    }
}

const unsigned long kReplacementChar = 0xFFFD;

bool IsHighSurrogate(unsigned long unit) {
    return unit >= 0xD800 && unit <= 0xDBFF;
}

bool IsLowSurrogate(unsigned long unit) {
    return unit >= 0xDC00 && unit <= 0xDFFF;
}

std::wstring ToWide(JNIEnv* env, jstring text) {
    std::wstring out;
    if (text == nullptr) return out;
    const jsize length = env->GetStringLength(text);
    if (length <= 0) return out;
    std::vector<jchar> units(static_cast<size_t>(length));
    env->GetStringRegion(text, 0, length, units.data());
    out.reserve(units.size());
    for (size_t i = 0; i < units.size(); ++i) {
        unsigned long code = units[i];
        if (IsHighSurrogate(code) && i + 1 < units.size() && IsLowSurrogate(units[i + 1])) {
            code = 0x10000 + ((code - 0xD800) << 10) + (units[i + 1] - 0xDC00);
            ++i;
        } else if (IsHighSurrogate(code) || IsLowSurrogate(code)) {
            code = kReplacementChar;
        }
        out.push_back(static_cast<wchar_t>(code));
    }
    return out;
}

// nullptr quando a JVM não conseguiu criar a String (a exceção fica pendente para o Kotlin).
jstring ToJava(JNIEnv* env, const std::wstring& text) {
    static const jchar kEmpty = 0;
    std::vector<jchar> units;
    units.reserve(text.size());
    for (const wchar_t ch : text) {
        unsigned long code = static_cast<unsigned long>(static_cast<std::make_unsigned<wchar_t>::type>(ch));
        if (code > 0x10FFFF || IsHighSurrogate(code) || IsLowSurrogate(code)) code = kReplacementChar;
        if (code >= 0x10000) {
            code -= 0x10000;
            units.push_back(static_cast<jchar>(0xD800 + (code >> 10)));
            units.push_back(static_cast<jchar>(0xDC00 + (code & 0x3FF)));
        } else {
            units.push_back(static_cast<jchar>(code));
        }
    }
    return env->NewString(units.empty() ? &kEmpty : units.data(), static_cast<jsize>(units.size()));
}

template <typename Check>
const char* CheckName(Check check) {
    switch (check) {
        case Check::Ok:
            return "ok";
        case Check::Empty:
            return "empty";
        case Check::Invalid:
            break;
    }
    return "invalid";
}

// [ok|empty|invalid, texto]: o valor normalizado quando é ok, senão o aviso da tela Entrar. nullptr com
// exceção pendente.
template <typename Check>
jobjectArray CheckResult(JNIEnv* env, Check check, const std::wstring& text) {
    jclass stringClass = env->FindClass("java/lang/String");
    if (stringClass == nullptr) return nullptr;
    jobjectArray result = env->NewObjectArray(2, stringClass, nullptr);
    env->DeleteLocalRef(stringClass);
    if (result == nullptr) return nullptr;
    jstring name = env->NewStringUTF(CheckName(check));
    if (name == nullptr) return nullptr;
    env->SetObjectArrayElement(result, 0, name);
    env->DeleteLocalRef(name);
    jstring value = ToJava(env, text);
    if (value == nullptr) return nullptr;
    env->SetObjectArrayElement(result, 1, value);
    env->DeleteLocalRef(value);
    return result;
}

// Um String[] com os textos, na ordem. nullptr com exceção pendente.
jobjectArray StringArray(JNIEnv* env, const std::vector<std::wstring>& texts) {
    jclass stringClass = env->FindClass("java/lang/String");
    if (stringClass == nullptr) return nullptr;
    jobjectArray result = env->NewObjectArray(static_cast<jsize>(texts.size()), stringClass, nullptr);
    env->DeleteLocalRef(stringClass);
    if (result == nullptr) return nullptr;
    for (size_t i = 0; i < texts.size(); ++i) {
        jstring value = ToJava(env, texts[i]);
        if (value == nullptr) return nullptr;
        env->SetObjectArrayElement(result, static_cast<jsize>(i), value);
        env->DeleteLocalRef(value);
    }
    return result;
}

// Uma String do Java feita de texto UTF-8 do motor, solta no fim do escopo: numa thread nativa presa à
// JVM as referências locais só sairiam quando ela acabasse.
class LocalString {
public:
    LocalString(JNIEnv* env, const std::string& utf8) : env_(env), value_(ToJava(env, starsonic::Utf8ToWide(utf8))) {}
    ~LocalString() {
        if (value_ != nullptr) env_->DeleteLocalRef(value_);
    }
    LocalString(const LocalString&) = delete;
    LocalString& operator=(const LocalString&) = delete;

    // nullptr se a JVM não criou a String (com a exceção pendente).
    jstring get() const { return value_; }

private:
    JNIEnv* env_;
    jstring value_;
};

// Os avisos do motor para o Kotlin, por um br.com.starsonic.phone.engine.EngineSink (o NativeSipGateway
// passa um no start; o proguard-rules.pro mantém os nomes dos métodos). Os eventos chegam na thread da
// fila do motor; as linhas de log, em qualquer thread do PJSIP ou na que chamou o motor. O EngineSink só
// passa o aviso a uma thread do gateway, então nenhuma delas espera o app.
class JniListener : public starsonic::EngineListener {
public:
    // Guarda o sink e os métodos dele. false se falta algum (com a exceção pendente).
    bool Init(JNIEnv* env, jobject sink) {
        jclass type = env->GetObjectClass(sink);
        if (type == nullptr) return false;
        onRegistration_ = env->GetMethodID(type, "onRegistration", "(IZI)V");
        if (onRegistration_ != nullptr) {
            onIncomingCall_ = env->GetMethodID(type, "onIncomingCall", "(ILjava/lang/String;Ljava/lang/String;)V");
        }
        if (onIncomingCall_ != nullptr) {
            onRejectedBusy_ = env->GetMethodID(type, "onRejectedBusy", "(Ljava/lang/String;Ljava/lang/String;)V");
        }
        if (onRejectedBusy_ != nullptr) onCallState_ = env->GetMethodID(type, "onCallState", "(III)V");
        if (onCallState_ != nullptr) onTransfer_ = env->GetMethodID(type, "onTransfer", "(II)V");
        if (onTransfer_ != nullptr) onLog_ = env->GetMethodID(type, "onLog", "(ILjava/lang/String;)V");
        env->DeleteLocalRef(type);
        if (onLog_ == nullptr) return false;
        sink_ = env->NewGlobalRef(sink);
        return sink_ != nullptr;
    }

    // Solta o sink: só depois de destruir o motor, que ainda escreve linhas de log ao sair.
    void Release(JNIEnv* env) {
        if (sink_ != nullptr) env->DeleteGlobalRef(sink_);
        sink_ = nullptr;
    }

    void OnRegistration(int sipCode, bool active, int accountId) override {
        Deliver(kEventThreadName, [&](JNIEnv* env) {
            env->CallVoidMethod(sink_, onRegistration_, static_cast<jint>(sipCode), active ? JNI_TRUE : JNI_FALSE,
                                static_cast<jint>(accountId));
        });
    }

    void OnIncomingCall(int callId, const std::string& remoteUser, const std::string& remoteName) override {
        Deliver(kEventThreadName, [&](JNIEnv* env) {
            LocalString user(env, remoteUser);
            if (user.get() == nullptr) return;
            LocalString name(env, remoteName);
            if (name.get() == nullptr) return;
            env->CallVoidMethod(sink_, onIncomingCall_, static_cast<jint>(callId), user.get(), name.get());
        });
    }

    void OnRejectedBusy(const std::string& remoteUser, const std::string& remoteName) override {
        Deliver(kEventThreadName, [&](JNIEnv* env) {
            LocalString user(env, remoteUser);
            if (user.get() == nullptr) return;
            LocalString name(env, remoteName);
            if (name.get() == nullptr) return;
            env->CallVoidMethod(sink_, onRejectedBusy_, user.get(), name.get());
        });
    }

    void OnCallState(int callId, starsonic::CallState state, int sipCode) override {
        Deliver(kEventThreadName, [&](JNIEnv* env) {
            env->CallVoidMethod(sink_, onCallState_, static_cast<jint>(callId), static_cast<jint>(state),
                                static_cast<jint>(sipCode));
        });
    }

    void OnTransfer(int callId, int sipCode) override {
        Deliver(kEventThreadName, [&](JNIEnv* env) {
            env->CallVoidMethod(sink_, onTransfer_, static_cast<jint>(callId), static_cast<jint>(sipCode));
        });
    }

    void OnLog(int level, const std::string& line) override {
        Deliver(kLogThreadName, [&](JNIEnv* env) {
            LocalString text(env, line);
            if (text.get() != nullptr) env->CallVoidMethod(sink_, onLog_, static_cast<jint>(level), text.get());
        });
    }

private:
    template <typename Body>
    void Deliver(const char* threadName, Body body) {
        JNIEnv* env = AttachedEnv(threadName);
        if (env == nullptr || sink_ == nullptr) return;
        // Uma exceção já pendente nesta thread (de outra chamada JNI, como as do áudio do PJSIP) fica
        // guardada e volta no fim: nenhuma chamada JNI pode ser feita com ela pendente.
        jthrowable pending = env->ExceptionOccurred();
        if (pending != nullptr) env->ExceptionClear();
        body(env);
        DropPendingException(env);
        if (pending != nullptr) {
            env->Throw(pending);
            env->DeleteLocalRef(pending);
        }
    }

    jobject sink_ = nullptr;
    jmethodID onRegistration_ = nullptr;
    jmethodID onIncomingCall_ = nullptr;
    jmethodID onRejectedBusy_ = nullptr;
    jmethodID onCallState_ = nullptr;
    jmethodID onTransfer_ = nullptr;
    jmethodID onLog_ = nullptr;
};

// O motor e quem recebe os avisos dele. O motor é destruído antes (os campos saem na ordem inversa).
struct EngineHolder {
    JniListener listener;
    std::unique_ptr<starsonic::SipEngine> engine;
};

EngineHolder* HolderOf(jlong handle) {
    return reinterpret_cast<EngineHolder*>(static_cast<intptr_t>(handle));
}

starsonic::LoginFlow* FlowOf(jlong handle) {
    return reinterpret_cast<starsonic::LoginFlow*>(static_cast<intptr_t>(handle));
}

// O desfecho do LoginFlow para o Kotlin (LoginFlowHandle): 0 = nada a fazer, 1 = confirmou, 2 = desfez. O
// aviso de cada falha o Kotlin pega no CoreRules.
jint OutcomeKind(const starsonic::LoginOutcome& outcome) {
    if (outcome.commit) return 1;
    return outcome.rollback ? 2 : 0;
}

}  // namespace

extern "C" {

// O PJLIB do app é compilado sem o JNI_OnLoad dele (PJ_JNI_HAS_JNI_ONLOAD 0): a JVM chega ao PJSIP
// por aqui, e o áudio Oboe a usa para falar com org.pjsip.PjAudioDevInfo.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /* reserved */) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
    g_vm = vm;
    g_attachedThreadKeyReady = pthread_key_create(&g_attachedThreadKey, DetachAttachedThread) == 0;
    pj_jni_set_jvm(vm);
    return JNI_VERSION_1_6;
}

JNIEXPORT jobjectArray JNICALL Java_br_com_starsonic_phone_Native_validateServer(JNIEnv* env, jobject /* native */,
                                                                                 jstring raw) {
    std::wstring normalized;
    const starsonic::ServerCheck check = starsonic::ValidateServerAddress(ToWide(env, raw), &normalized);
    return CheckResult(env, check,
                       check == starsonic::ServerCheck::Ok ? normalized : starsonic::ServerCheckMessage(check));
}

JNIEXPORT jobjectArray JNICALL Java_br_com_starsonic_phone_Native_validateRamal(JNIEnv* env, jobject /* native */,
                                                                                jstring raw) {
    std::wstring normalized;
    const starsonic::RamalCheck check = starsonic::ValidateRamal(ToWide(env, raw), &normalized);
    return CheckResult(env, check, check == starsonic::RamalCheck::Ok ? normalized : starsonic::RamalCheckMessage(check));
}

JNIEXPORT jstring JNICALL Java_br_com_starsonic_phone_Native_registrationMessage(JNIEnv* env, jobject /* native */,
                                                                                 jint code) {
    return ToJava(env, starsonic::RegistrationMessage(code, false));
}

JNIEXPORT jstring JNICALL Java_br_com_starsonic_phone_Native_callEndMessage(JNIEnv* env, jobject /* native */,
                                                                            jint code) {
    return ToJava(env, starsonic::CallEndMessage(code));
}

JNIEXPORT jstring JNICALL Java_br_com_starsonic_phone_Native_normalizeDialString(JNIEnv* env, jobject /* native */,
                                                                                 jstring raw) {
    return ToJava(env, starsonic::NormalizeDialString(ToWide(env, raw)));
}

// O protocolo padrão do perfil (o do campo Protocolo da tela Entrar): "udp" ou "tcp"; "" se o perfil não vale.
JNIEXPORT jstring JNICALL Java_br_com_starsonic_phone_Native_profileTransport(JNIEnv* env, jobject /* native */,
                                                                              jstring profileText) {
    starsonic::Profile profile;
    if (!starsonic::ParseProfile(ToWide(env, profileText), &profile).ok) return ToJava(env, L"");
    return ToJava(env, profile.account.transport == starsonic::Transport::Tcp ? L"tcp" : L"udp");
}

// ContactDialString: o número de um contato do aparelho, pronto para discar, com o ddi e o prefixo externo do perfil.
JNIEXPORT jstring JNICALL Java_br_com_starsonic_phone_Native_contactDialString(JNIEnv* env, jobject /* native */,
                                                                               jstring raw, jstring ddi,
                                                                               jstring prefix) {
    return ToJava(env, starsonic::ContactDialString(ToWide(env, raw), ToWide(env, ddi), ToWide(env, prefix)));
}

// O ddi e o prefixo externo do perfil (as chaves ddi e prefixo_externo de [conta]): [ddi, prefixo]; ["", ""] se o
// perfil não vale.
JNIEXPORT jobjectArray JNICALL Java_br_com_starsonic_phone_Native_profileDial(JNIEnv* env, jobject /* native */,
                                                                              jstring profileText) {
    starsonic::Profile profile;
    if (!starsonic::ParseProfile(ToWide(env, profileText), &profile).ok) return StringArray(env, {L"", L""});
    return StringArray(env, {profile.account.ddi, profile.account.externalPrefix});
}

// ParseManifest (o versao-android.json, spec 7.7) com o endereço permitido do APK: [motivo, versão, APK, SHA-256,
// notas]. O motivo (em ASCII, para o log) é "" quando o arquivo vale; quando não vale, os outros ficam vazios. O
// JSON chega em UTF-16 e vai ao núcleo em UTF-8; as notas voltam com os pares substitutos refeitos.
JNIEXPORT jobjectArray JNICALL Java_br_com_starsonic_phone_Native_parseManifest(JNIEnv* env, jobject /* native */,
                                                                                jstring json, jstring allowedPrefix) {
    starsonic::Manifest manifest;
    std::string error;
    const bool ok = starsonic::ParseManifest(starsonic::WideToUtf8(ToWide(env, json)),
                                             starsonic::WideToUtf8(ToWide(env, allowedPrefix)), &manifest, &error);
    if (!ok) {
        return StringArray(env, {starsonic::Utf8ToWide(error.empty() ? "versao.json: invalido" : error), L"", L"", L"", L""});
    }
    return StringArray(env, {L"", starsonic::Utf8ToWide(manifest.versionText), starsonic::Utf8ToWide(manifest.installerUrl),
                             starsonic::Utf8ToWide(manifest.sha256), manifest.notes});
}

// CompareVersions de duas versões em texto (ParseVersion): -1, 0 ou 1. Um texto que não é versão não tem ordem: 0,
// como se fossem iguais (o atualizador não oferece nada).
JNIEXPORT jint JNICALL Java_br_com_starsonic_phone_Native_compareVersions(JNIEnv* env, jobject /* native */, jstring a,
                                                                         jstring b) {
    starsonic::Version first;
    starsonic::Version second;
    if (!starsonic::ParseVersion(starsonic::WideToUtf8(ToWide(env, a)), &first) ||
        !starsonic::ParseVersion(starsonic::WideToUtf8(ToWide(env, b)), &second)) {
        return 0;
    }
    return static_cast<jint>(starsonic::CompareVersions(first, second));
}

// O LoginFlow do núcleo (LoginFlowHandle): criado aqui e solto por nativeRelease; quem usa sincroniza as
// chamadas. 0 se faltou memória.
JNIEXPORT jlong JNICALL Java_br_com_starsonic_phone_core_LoginFlowHandle_nativeCreate(JNIEnv* /* env */,
                                                                                   jobject /* flow */) {
    return static_cast<jlong>(reinterpret_cast<intptr_t>(new (std::nothrow) starsonic::LoginFlow()));
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_core_LoginFlowHandle_nativeStart(JNIEnv* /* env */,
                                                                                  jobject /* flow */, jlong handle) {
    FlowOf(handle)->Start();
}

JNIEXPORT jint JNICALL Java_br_com_starsonic_phone_core_LoginFlowHandle_nativeOnRegistration(JNIEnv* /* env */,
                                                                                           jobject /* flow */,
                                                                                           jlong handle, jint code) {
    return OutcomeKind(FlowOf(handle)->OnRegistration(code, false));   // o Android não tem TLS
}

JNIEXPORT jint JNICALL Java_br_com_starsonic_phone_core_LoginFlowHandle_nativeOnTimeout(JNIEnv* /* env */,
                                                                                      jobject /* flow */,
                                                                                      jlong handle) {
    return OutcomeKind(FlowOf(handle)->OnTimeout());
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_core_LoginFlowHandle_nativeRelease(JNIEnv* /* env */,
                                                                                    jobject /* flow */, jlong handle) {
    delete FlowOf(handle);
}

// O motor (NativeSipGateway). Todas estas funções são chamadas da thread do gateway, uma de cada vez; o
// handle é o EngineHolder que nativeStart devolveu, até nativeStop.

// Sobe o motor com o perfil (o texto do perfil.ini) e o User-Agent; 0 se não subiu (o motivo vai ao log).
JNIEXPORT jlong JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeStart(
    JNIEnv* env, jobject /* gateway */, jstring userAgent, jstring profileText, jobject sink) {
    std::unique_ptr<EngineHolder> holder(new EngineHolder);
    if (!holder->listener.Init(env, sink)) {
        DropPendingException(env);
        return 0;
    }
    starsonic::Profile profile;
    const starsonic::ParseResult parsed = starsonic::ParseProfile(ToWide(env, profileText), &profile);
    if (!parsed.ok) {
        holder->listener.OnLog(1, "perfil recusado (linha " + std::to_string(parsed.errorLine) +
                                      "): " + starsonic::WideToUtf8(parsed.errorMessage));
        holder->listener.Release(env);
        return 0;
    }
    starsonic::EngineConfig config;
    config.userAgent = starsonic::WideToUtf8(ToWide(env, userAgent));
    config.profile = profile;
    std::string error;
    holder->engine = starsonic::SipEngine::Create(config, &holder->listener, &error);
    DropPendingException(env);
    if (!holder->engine) {
        holder->listener.OnLog(1, error.empty() ? std::string("o motor nao subiu") : error);
        holder->listener.Release(env);
        return 0;
    }
    return static_cast<jlong>(reinterpret_cast<intptr_t>(holder.release()));
}

// Desliga a ligação, tira a conta do servidor e destrói o motor (cerca de 1 s, ou mais sem resposta do
// servidor); depois solta o sink.
JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeStop(JNIEnv* env, jobject /* gateway */,
                                                                                      jlong handle) {
    EngineHolder* holder = HolderOf(handle);
    if (holder == nullptr) return;
    holder->engine.reset();
    DropPendingException(env);
    holder->listener.Release(env);
    delete holder;
}

// O id da conta (o que os avisos de registro dela trazem), ou 0 se o motor a recusou.
JNIEXPORT jint JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeSetAccount(
    JNIEnv* env, jobject /* gateway */, jlong handle, jstring address, jboolean tcp, jstring ramal, jstring senha) {
    starsonic::AccountInput input;
    input.address = ToWide(env, address);
    input.transport = tcp ? starsonic::Transport::Tcp : starsonic::Transport::Udp;
    input.ramal = ToWide(env, ramal);
    input.senha = ToWide(env, senha);
    const int accountId = HolderOf(handle)->engine->SetAccount(input);
    DropPendingException(env);
    return static_cast<jint>(accountId);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeRemoveAccount(JNIEnv* env,
                                                                                               jobject /* gateway */,
                                                                                               jlong handle) {
    HolderOf(handle)->engine->RemoveAccount();
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeReregister(JNIEnv* env,
                                                                                            jobject /* gateway */,
                                                                                            jlong handle) {
    HolderOf(handle)->engine->Reregister();
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeHandleIpChange(JNIEnv* env,
                                                                                                jobject /* gateway */,
                                                                                                jlong handle) {
    HolderOf(handle)->engine->HandleIpChange();
    DropPendingException(env);
}

JNIEXPORT jint JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeMakeCall(JNIEnv* env,
                                                                                          jobject /* gateway */,
                                                                                          jlong handle, jstring number) {
    const int callId = HolderOf(handle)->engine->MakeCall(starsonic::WideToUtf8(ToWide(env, number)));
    DropPendingException(env);
    return static_cast<jint>(callId);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeAnswer(JNIEnv* env,
                                                                                        jobject /* gateway */,
                                                                                        jlong handle, jint callId) {
    HolderOf(handle)->engine->Answer(callId);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeReject(JNIEnv* env,
                                                                                        jobject /* gateway */,
                                                                                        jlong handle, jint callId) {
    HolderOf(handle)->engine->Reject(callId);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeHangup(JNIEnv* env,
                                                                                        jobject /* gateway */,
                                                                                        jlong handle, jint callId) {
    HolderOf(handle)->engine->Hangup(callId);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeSetHold(JNIEnv* env,
                                                                                         jobject /* gateway */,
                                                                                         jlong handle, jint callId,
                                                                                         jboolean hold) {
    HolderOf(handle)->engine->SetHold(callId, hold == JNI_TRUE);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeActivate(JNIEnv* env,
                                                                                          jobject /* gateway */,
                                                                                          jlong handle, jint callId) {
    HolderOf(handle)->engine->Activate(callId);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeSetMute(JNIEnv* env,
                                                                                         jobject /* gateway */,
                                                                                         jlong handle, jboolean mute) {
    HolderOf(handle)->engine->SetMute(mute == JNI_TRUE);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeSendDtmf(JNIEnv* env,
                                                                                          jobject /* gateway */,
                                                                                          jlong handle, jint callId,
                                                                                          jstring digits) {
    HolderOf(handle)->engine->SendDtmf(callId, starsonic::WideToUtf8(ToWide(env, digits)));
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeTransfer(JNIEnv* env,
                                                                                          jobject /* gateway */,
                                                                                          jlong handle, jint callId,
                                                                                          jstring number) {
    HolderOf(handle)->engine->Transfer(callId, starsonic::WideToUtf8(ToWide(env, number)));
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeTransferAttended(
    JNIEnv* env, jobject /* gateway */, jlong handle, jint callId, jint targetCallId) {
    HolderOf(handle)->engine->TransferAttended(callId, targetCallId);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeJoin(JNIEnv* env,
                                                                                      jobject /* gateway */,
                                                                                      jlong handle, jint callId,
                                                                                      jint otherId) {
    HolderOf(handle)->engine->Join(callId, otherId);
    DropPendingException(env);
}

JNIEXPORT void JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeSplit(JNIEnv* env,
                                                                                       jobject /* gateway */,
                                                                                       jlong handle, jint callId,
                                                                                       jint otherId) {
    HolderOf(handle)->engine->Split(callId, otherId);
    DropPendingException(env);
}

JNIEXPORT jboolean JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeHasCall(JNIEnv* /* env */,
                                                                                             jobject /* gateway */,
                                                                                             jlong handle) {
    return HolderOf(handle)->engine->HasCall() ? JNI_TRUE : JNI_FALSE;
}

JNIEXPORT jint JNICALL Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeCallCount(JNIEnv* /* env */,
                                                                                           jobject /* gateway */,
                                                                                           jlong handle) {
    return static_cast<jint>(HolderOf(handle)->engine->CallCount());
}

}  // extern "C"
