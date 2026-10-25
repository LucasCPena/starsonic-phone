// O diálogo "Área do administrador" (rc.3, spec 6.1): o Ctrl + P da janela principal o abre (main.tsx); a senha vai no
// adminLogin e o C++ a confere (só um resumo PBKDF2-SHA256 fica no programa), respondendo no `entrarAdmin`. Só quando a
// `vez` muda depois de este diálogo mandar o adminLogin, o campo é limpo e o `erro` aparece ("Senha incorreta."; sem
// erro, a área abriu): um erro de antes (o diálogo aberto de novo) não aparece. Até essa resposta, o Entrar fica
// travado e o Enter não manda outra tentativa (todo adminLogin é respondido; um Enter duplo não conta duas erradas).
// Enquanto `esperaAte` está no futuro (5 senhas erradas seguidas), o Entrar também fica travado, com a espera contada
// em segundos. Esc e Cancelar fecham sem mandar nada; um <dialog> modal, como o Confirm.
import { useEffect, useRef, useState } from 'preact/hooks';
import { IconAlert, IconLock } from '../icons';
import type { AdminLoginResult } from '../state';
import type { Send } from '../types';

interface Props {
  entrarAdmin: AdminLoginResult;
  send: Send;
  onCancel(): void;
  /** A senha certa: a área abriu. */
  onOpened(): void;
}

export function AdminLogin({ entrarAdmin, send, onCancel, onOpened }: Props) {
  const ref = useRef<HTMLDialogElement>(null);
  const campo = useRef<HTMLInputElement>(null);
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState('');
  // A vez de quando o diálogo abriu (ou da última resposta vista) e quantas tentativas daqui esperam a resposta.
  const vezVista = useRef(entrarAdmin.vez);
  const esperandoResposta = useRef(0);
  // A tentativa mandada, até a resposta (o Entrar travado).
  const [aguardando, setAguardando] = useState(false);
  const [agora, setAgora] = useState(() => Date.now());

  useEffect(() => {
    const dialogo = ref.current!;
    if (!dialogo.open) dialogo.showModal();
    campo.current?.focus();
    const cancelar = (e: Event) => {
      e.preventDefault();
      onCancel();
    };
    dialogo.addEventListener('cancel', cancelar);
    return () => dialogo.removeEventListener('cancel', cancelar);
  }, []);

  // A resposta do C++ a uma tentativa deste diálogo: a vez mudou.
  useEffect(() => {
    const respostas = entrarAdmin.vez - vezVista.current;
    vezVista.current = entrarAdmin.vez;
    if (respostas <= 0 || esperandoResposta.current === 0) return;
    esperandoResposta.current = Math.max(0, esperandoResposta.current - respostas);
    if (esperandoResposta.current === 0) setAguardando(false);
    setSenha('');
    if (entrarAdmin.erro) {
      setErro(entrarAdmin.erro);
      campo.current?.focus();
    } else {
      onOpened();
    }
  }, [entrarAdmin.vez]);

  // A contagem da espera (só enquanto ela dura).
  useEffect(() => {
    const ate = entrarAdmin.esperaAte;
    setAgora(Date.now());
    if (ate <= Date.now()) return;
    const t = setInterval(() => {
      const ms = Date.now();
      setAgora(ms);
      if (ms >= ate) clearInterval(t);
    }, 250);
    return () => clearInterval(t);
  }, [entrarAdmin.esperaAte]);

  const restanteMs = entrarAdmin.esperaAte - agora;
  const esperando = entrarAdmin.esperaAte > 0 && restanteMs > 0;
  const descricao = [erro ? 'adm-erro' : '', esperando ? 'adm-espera' : ''].filter(Boolean).join(' ');

  const entrar = (e: Event) => {
    e.preventDefault();
    // A ref, e não o estado: o segundo Enter de um Enter duplo chega antes de o Entrar aparecer travado.
    if (!senha || esperando || esperandoResposta.current > 0) return;
    esperandoResposta.current += 1;
    setAguardando(true);
    send({ cmd: 'adminLogin', senha });
  };

  return (
    <dialog ref={ref} class="dialog dialog-adm" aria-labelledby="adm-titulo" aria-describedby="adm-texto">
      <form class="adm-form" onSubmit={entrar} noValidate>
        <div class="adm-topo">
          <span class="adm-tile" aria-hidden="true">
            <IconLock />
          </span>
          <div class="adm-titulos">
            <h2 id="adm-titulo">Área do administrador</h2>
            <p id="adm-texto">Configurações da Starsonic para este computador.</p>
          </div>
        </div>
        <div class="field">
          <label class="label" for="adm-senha">
            Senha
          </label>
          <input
            ref={campo}
            id="adm-senha"
            class="input"
            type="password"
            autocomplete="off"
            value={senha}
            aria-invalid={erro ? 'true' : undefined}
            aria-describedby={descricao || undefined}
            onInput={(e) => setSenha(e.currentTarget.value)}
          />
          {erro && (
            <p class="field-error" id="adm-erro" role="alert">
              <IconAlert size="sm" />
              <span>{erro}</span>
            </p>
          )}
          {esperando && (
            <p class="adm-espera" id="adm-espera">
              {`Muitas tentativas. Tente de novo em ${Math.ceil(restanteMs / 1000)} s.`}
            </p>
          )}
        </div>
        <div class="dialog-actions adm-acoes">
          <button type="button" class="btn btn-outline" onClick={onCancel}>
            Cancelar
          </button>
          <button type="submit" class="btn btn-blue" disabled={!senha || esperando || aguardando}>
            Entrar
          </button>
        </div>
      </form>
    </dialog>
  );
}
