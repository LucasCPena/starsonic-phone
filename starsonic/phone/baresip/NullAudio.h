#pragma once
// O dispositivo de som nulo do motor com o baresip (o nullAudio do EngineConfig, para os testes): uma fonte e uma saída
// de som chamadas nullaudio, que abrem sempre, nunca mandam amostras e nunca pedem amostras. Como o dispositivo nulo do
// PJSIP: a ligação tem o áudio aberto sem nenhum som do sistema.

namespace starsonic {

// O nome das duas no baresip (o módulo do audio_source e do audio_player da configuração).
extern const char kNullAudioName[];

// Registra a fonte (ausrc_register) e a saída (auplay_register) no baresip; 0 ou o código de erro (nesse caso, nada
// fica registrado). Na thread do laço, depois do baresip_init.
int RegisterNullAudio();

// Tira as duas do baresip (sem nada registrado, nada). Na thread do laço, sem nenhuma ligação.
void UnregisterNullAudio();

// Quantas fontes nulas (os microfones das ligações) estão abertas agora, para os testes (SipEngineTestAccess). De
// qualquer thread.
int OpenNullSources();

}  // namespace starsonic
