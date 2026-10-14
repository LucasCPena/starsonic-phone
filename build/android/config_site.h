/* pjproject para o Android (app Starsonic Phone): copiado para pjlib/include/pj/config_site.h. */
#define PJ_CONFIG_ANDROID        1
#include <pj/config_site_sample.h>

/* O que a Starsonic muda em cima dos valores do exemplo do Android do PJSIP. */
#undef  PJMEDIA_HAS_VIDEO
#define PJMEDIA_HAS_VIDEO        0
#undef  PJMEDIA_HAS_SRTP
#define PJMEDIA_HAS_SRTP         1
#undef  PJMEDIA_SRTP_HAS_DTLS
#define PJMEDIA_SRTP_HAS_DTLS    0
#undef  PJMEDIA_HAS_OPUS_CODEC
#define PJMEDIA_HAS_OPUS_CODEC   1
#undef  PJMEDIA_HAS_WEBRTC_AEC
#define PJMEDIA_HAS_WEBRTC_AEC   1

/* O audio e do Oboe (--with-oboe define PJMEDIA_AUDIO_DEV_HAS_OBOE); o exemplo liga o
 * dispositivo JNI antigo, que aqui fica desligado. */
#undef  PJMEDIA_AUDIO_DEV_HAS_ANDROID_JNI
#define PJMEDIA_AUDIO_DEV_HAS_ANDROID_JNI  0

/* O JNI_OnLoad e da ponte do app, que chama pj_jni_set_jvm; o PJLIB nao define o seu. */
#undef  PJ_JNI_HAS_JNI_ONLOAD
#define PJ_JNI_HAS_JNI_ONLOAD    0

#undef  PJSUA_MAX_CALLS
#define PJSUA_MAX_CALLS          4

/* Build de producao, como o do Windows: sem os assert() do PJSIP. O PJ_DEBUG vale 1 quando nao ha
 * -DNDEBUG, e com ele o PJ_ASSERT_RETURN chama assert() antes de devolver o erro: um call id velho
 * vindo da ponte derrubaria o app inteiro, com o servico em primeiro plano, em vez de virar um
 * pj::Error que a ponte captura. Os assert() puros (PJLIB, WebRTC) saem com o -DNDEBUG que o
 * build-deps.sh passa no CFLAGS. */
#undef  PJ_DEBUG
#define PJ_DEBUG                 0
