// Ponte JNI do app Android: liga o Kotlin (br.com.starsonic.phone.Native) ao núcleo em C++.
// Por enquanto, o JNI_OnLoad e as funções do núcleo que as telas usam (validar o servidor e o ramal e os
// textos do registro e do fim da ligação); o motor de ligações (SipEngine) entra depois.
//
// Texto: o Java guarda as String em UTF-16 e, no Android, o wchar_t tem 32 bits (uma unidade por
// caractere, como o núcleo espera). As conversões abaixo juntam e separam os pares substitutos; um
// substituto solto vira U+FFFD, como no WideToUtf8 do núcleo.
#include <jni.h>

#include <pj/os.h>

#include <string>
#include <type_traits>
#include <vector>

#include "AccountPolicy.h"
#include "CallMessages.h"
#include "RegistrationErrors.h"

namespace {

// A JVM do app, guardada no JNI_OnLoad (o motor vai precisar dela para anexar as threads do PJSIP).
JavaVM* g_vm = nullptr;

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

// [ok|empty|invalid, normalizado]; o normalizado só vem quando é ok. nullptr com exceção pendente.
template <typename Check>
jobjectArray CheckResult(JNIEnv* env, Check check, const std::wstring& normalized) {
    jclass stringClass = env->FindClass("java/lang/String");
    if (stringClass == nullptr) return nullptr;
    jobjectArray result = env->NewObjectArray(2, stringClass, nullptr);
    env->DeleteLocalRef(stringClass);
    if (result == nullptr) return nullptr;
    jstring name = env->NewStringUTF(CheckName(check));
    if (name == nullptr) return nullptr;
    env->SetObjectArrayElement(result, 0, name);
    env->DeleteLocalRef(name);
    jstring value = ToJava(env, check == Check::Ok ? normalized : std::wstring());
    if (value == nullptr) return nullptr;
    env->SetObjectArrayElement(result, 1, value);
    env->DeleteLocalRef(value);
    return result;
}

}  // namespace

extern "C" {

// O PJLIB do app é compilado sem o JNI_OnLoad dele (PJ_JNI_HAS_JNI_ONLOAD 0): a JVM chega ao PJSIP
// por aqui, e o áudio Oboe a usa para falar com org.pjsip.PjAudioDevInfo.
JNIEXPORT jint JNICALL JNI_OnLoad(JavaVM* vm, void* /* reserved */) {
    JNIEnv* env = nullptr;
    if (vm->GetEnv(reinterpret_cast<void**>(&env), JNI_VERSION_1_6) != JNI_OK) return JNI_ERR;
    g_vm = vm;
    pj_jni_set_jvm(vm);
    return JNI_VERSION_1_6;
}

JNIEXPORT jobjectArray JNICALL Java_br_com_starsonic_phone_Native_validateServer(JNIEnv* env, jobject /* native */,
                                                                                 jstring raw) {
    std::wstring normalized;
    const starsonic::ServerCheck check = starsonic::ValidateServerAddress(ToWide(env, raw), &normalized);
    return CheckResult(env, check, normalized);
}

JNIEXPORT jobjectArray JNICALL Java_br_com_starsonic_phone_Native_validateRamal(JNIEnv* env, jobject /* native */,
                                                                                jstring raw) {
    std::wstring normalized;
    const starsonic::RamalCheck check = starsonic::ValidateRamal(ToWide(env, raw), &normalized);
    return CheckResult(env, check, normalized);
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

}  // extern "C"
