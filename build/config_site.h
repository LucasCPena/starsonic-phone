/* pjproject: configuracao do Starsonic Phone (copiada para pjlib/include/pj/config_site.h). */
#define PJ_HAS_SSL_SOCK          1
#define PJ_SSL_SOCK_IMP          PJ_SSL_SOCK_IMP_OPENSSL
#define PJMEDIA_HAS_SRTP         1
#define PJMEDIA_SRTP_HAS_DTLS    1
#define PJMEDIA_HAS_OPUS_CODEC   1
#define PJMEDIA_HAS_BCG729       1
#define PJMEDIA_HAS_WEBRTC_AEC   1

/* Video (spec da videochamada, 6.2): a camera pelo DirectShow; o VP8 e o VP9 pela libvpx do vcpkg; o H.264 pelo
   OpenH264, com os cabecalhos da API em starsonic/third_party/openh264 e o modulo da Cisco carregado pelo adaptador do
   app (windows/app/src/OpenH264Shim.cpp); e a libyuv do proprio pjproject, para converter e escalar as imagens. Sem o
   SDL (a imagem vai para a pagina, nao para janelas proprias) e sem o FFmpeg. Sem a camera de teste da PJSIP (barras
   coloridas), que apareceria na lista das cameras. */
#define PJMEDIA_HAS_VIDEO                1
#define PJMEDIA_VIDEO_DEV_HAS_DSHOW      1
#define PJMEDIA_VIDEO_DEV_HAS_SDL        0
#define PJMEDIA_VIDEO_DEV_HAS_CBAR_SRC   0
#define PJMEDIA_HAS_FFMPEG               0
#define PJMEDIA_HAS_VPX_CODEC            1
#define PJMEDIA_HAS_VPX_CODEC_VP9        1
#define PJMEDIA_HAS_OPENH264_CODEC       1
#define PJMEDIA_HAS_LIBYUV               1

/* Compatibilidade: o MicroSIP 3.22.16 usa o nome antigo do limite de dispositivos de audio. */
#define PJMEDIA_AUD_MAX_DEVS     PJMEDIA_AUD_DEV_MAX_DEVS
