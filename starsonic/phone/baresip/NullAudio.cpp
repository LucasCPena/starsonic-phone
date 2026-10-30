#include "NullAudio.h"

#include <re.h>
#include <baresip.h>

#include <atomic>

namespace starsonic {

// O baresip guarda o ponteiro do nome, sem copiar.
const char kNullAudioName[] = "nullaudio";

namespace {

struct ausrc* g_source = nullptr;
struct auplay* g_player = nullptr;
std::atomic<int> g_openSources{0};   // as fontes abertas agora (OpenNullSources)

// O que o baresip recebe de cada abertura e só solta (mem_deref): nada a guardar.
struct NullStream {
    char unused;
};

// O baresip soltou uma fonte (o audio_stop, a troca do codec ou o fim da ligação).
void CloseSource(void* /*data*/) { --g_openSources; }

// Abre sempre e nunca chama o rh: nenhuma amostra sai do microfone.
int OpenSource(struct ausrc_st** stp, const struct ausrc* /*ausrc*/, struct ausrc_prm* /*prm*/,
               const char* /*device*/, ausrc_read_h* /*rh*/, ausrc_error_h* /*errh*/, void* /*arg*/) {
    if (!stp) return EINVAL;
    void* stream = mem_zalloc(sizeof(NullStream), CloseSource);
    if (!stream) return ENOMEM;
    ++g_openSources;
    *stp = static_cast<struct ausrc_st*>(stream);
    return 0;
}

// Abre sempre e nunca chama o wh: nenhuma amostra é pedida para o alto-falante.
int OpenPlayer(struct auplay_st** stp, const struct auplay* /*auplay*/, struct auplay_prm* /*prm*/,
               const char* /*device*/, auplay_write_h* /*wh*/, void* /*arg*/) {
    if (!stp) return EINVAL;
    void* stream = mem_zalloc(sizeof(NullStream), nullptr);
    if (!stream) return ENOMEM;
    *stp = static_cast<struct auplay_st*>(stream);
    return 0;
}

}  // namespace

int RegisterNullAudio() {
    int err = ausrc_register(&g_source, baresip_ausrcl(), kNullAudioName, OpenSource);
    if (!err) err = auplay_register(&g_player, baresip_auplayl(), kNullAudioName, OpenPlayer);
    if (err) UnregisterNullAudio();
    return err;
}

void UnregisterNullAudio() {
    // O destrutor de cada um o tira da lista do baresip.
    g_player = static_cast<struct auplay*>(mem_deref(g_player));
    g_source = static_cast<struct ausrc*>(mem_deref(g_source));
}

int OpenNullSources() { return g_openSources.load(); }

}  // namespace starsonic
