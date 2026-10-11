/* pjproject: configuracao do Starsonic Phone (copiada para pjlib/include/pj/config_site.h). */
#define PJMEDIA_HAS_VIDEO        0
#define PJ_HAS_SSL_SOCK          1
#define PJ_SSL_SOCK_IMP          PJ_SSL_SOCK_IMP_OPENSSL
#define PJMEDIA_HAS_SRTP         1
#define PJMEDIA_SRTP_HAS_DTLS    1
#define PJMEDIA_HAS_OPUS_CODEC   1
#define PJMEDIA_HAS_BCG729       1
#define PJMEDIA_HAS_WEBRTC_AEC   1

/* Compatibilidade: o MicroSIP 3.22.16 usa o nome antigo do limite de dispositivos de audio. */
#define PJMEDIA_AUD_MAX_DEVS     PJMEDIA_AUD_DEV_MAX_DEVS
