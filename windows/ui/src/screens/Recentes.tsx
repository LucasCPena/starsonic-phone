// Os Recentes: Todas e Perdidas (com a contagem), os grupos por dia (Hoje, Ontem, a data) e, em cada linha, o tipo
// (perdida em vermelho), o nome ou número, a hora e a duração, mais o botão de ligar. Tocar na linha abre "Ligar" e
// "Salvar contato". Abrir a tela manda o viewRecents (o C++ zera `perdidas`).
import { useEffect, useRef, useState } from 'preact/hooks';
import { clockTime, dayGroup, duration, recentKindLabel } from '../format';
import { IconIncoming, IconOutgoing, IconPhone } from '../icons';
import type { RecentCall } from '../state';
import type { Send } from '../types';

interface Props {
  recentes: RecentCall[];
  perdidas: number;
  send: Send;
  onSaveContact(numero: string, nome: string): void;
}

function subLine(r: RecentCall): string {
  const partes = [recentKindLabel(r.tipo), clockTime(r.inicio)];
  if (r.duracao > 0) partes.push(duration(r.duracao));
  return partes.join(' · ');
}

export function Recentes({ recentes, perdidas, send, onSaveContact }: Props) {
  const [filtro, setFiltro] = useState<'todas' | 'perdidas'>('todas');
  const [aberta, setAberta] = useState<number | null>(null);
  // As perdidas que a pessoa ainda não tinha visto: o C++ zera a contagem quando a tela abre, e o filtro guarda
  // quantas eram (e soma as que chegam com a tela aberta).
  const [vistas, setVistas] = useState(0);
  const primeira = useRef(true);
  useEffect(() => {
    if (perdidas > 0) setVistas((v) => v + perdidas);
    if (primeira.current || perdidas > 0) send({ cmd: 'viewRecents' });
    primeira.current = false;
  }, [perdidas]);

  const lista = recentes.map((r, i) => ({ r, i })).filter(({ r }) => filtro === 'todas' || r.tipo === 'perdida');
  const grupos: Array<{ titulo: string; itens: typeof lista }> = [];
  const agora = Date.now();
  for (const item of lista) {
    const titulo = dayGroup(item.r.inicio, agora);
    const ultimo = grupos[grupos.length - 1];
    if (ultimo && ultimo.titulo === titulo) ultimo.itens.push(item);
    else grupos.push({ titulo, itens: [item] });
  }

  return (
    <div class="body scroll" style={{ gap: '6px' }}>
      <div class="filters">
        <button type="button" class={filtro === 'todas' ? 'pill pill-on' : 'pill'} aria-pressed={filtro === 'todas'} onClick={() => setFiltro('todas')}>
          Todas
        </button>
        <button
          type="button"
          class={filtro === 'perdidas' ? 'pill pill-on' : 'pill'}
          aria-pressed={filtro === 'perdidas'}
          onClick={() => setFiltro('perdidas')}
        >
          {vistas > 0 ? `Perdidas · ${vistas}` : 'Perdidas'}
        </button>
      </div>
      {lista.length === 0 && <p class="empty">{filtro === 'todas' ? 'Nenhuma ligação ainda.' : 'Nenhuma ligação perdida.'}</p>}
      {grupos.map((g) => (
        <section key={g.titulo} aria-label={g.titulo}>
          <h2 class="group">{g.titulo}</h2>
          <ul class="list">
            {g.itens.map(({ r, i }) => {
              const titulo = r.nome || r.numero;
              const aberto = aberta === i;
              return (
                <li class="row-wrap" key={i}>
                  <div class="row">
                    <button
                      type="button"
                      class="row-hit"
                      aria-expanded={aberto}
                      aria-controls={aberto ? `recente-${i}` : undefined}
                      onClick={() => setAberta(aberto ? null : i)}
                    >
                      <span class={r.tipo === 'perdida' ? 'tile tile-miss' : 'tile'} aria-hidden="true">
                        {r.tipo === 'feita' ? <IconOutgoing /> : <IconIncoming />}
                      </span>
                      <span class="row-main">
                        <span class="row-title">{titulo}</span>
                        <span class="row-sub">{subLine(r)}</span>
                      </span>
                    </button>
                    <button
                      type="button"
                      class="row-call"
                      aria-label={`Ligar para ${titulo}`}
                      title={`Ligar para ${titulo}`}
                      onClick={() => send({ cmd: 'dial', numero: r.numero })}
                    >
                      <IconPhone size="sm" />
                    </button>
                  </div>
                  {aberto && (
                    <div class="row-actions" id={`recente-${i}`}>
                      <button type="button" class="btn btn-cyan mini" onClick={() => send({ cmd: 'dial', numero: r.numero })}>
                        <IconPhone size="sm" />
                        Ligar
                      </button>
                      {r.contatoId === '' && (
                        <button type="button" class="btn btn-outline mini" onClick={() => onSaveContact(r.numero, r.nome)}>
                          Salvar contato
                        </button>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
