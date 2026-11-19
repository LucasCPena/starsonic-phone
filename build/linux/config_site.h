/* pjproject para o Linux (testes do motor de ligacoes): copiado para pjlib/include/pj/config_site.h. Com o video, como
   no Windows: o VP8 e o VP9 pela libvpx (o VP9 vem desligado na PJSIP) e o H.264 pelo OpenH264 do sistema; a camera
   dos testes e a de barras coloridas do PJSIP (PJMEDIA_VIDEO_DEV_HAS_CBAR_SRC, ligada por padrao). */
#define PJMEDIA_HAS_VIDEO        1
#define PJMEDIA_HAS_VPX_CODEC_VP9 1
#define PJMEDIA_HAS_SRTP         1
#define PJSUA_MAX_CALLS          8
