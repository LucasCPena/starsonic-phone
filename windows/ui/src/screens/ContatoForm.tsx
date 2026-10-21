// Novo contato (pelo "+" dos Contatos ou por "Salvar contato" nos Recentes) e Editar: nome, número e observação.
// O C++ confere nome e número (sem eles nada é gravado); o `required` só evita mandar um formulário vazio.
import { useState } from 'preact/hooks';
import { BackBar } from '../components/BackBar';
import type { Contact } from '../state';
import type { Send } from '../types';

interface Props {
  contato?: Contact;
  numero?: string;
  nome?: string;
  send: Send;
  onClose(): void;
}

export function ContatoForm({ contato, numero, nome, send, onClose }: Props) {
  const [campos, setCampos] = useState({
    nome: contato?.nome ?? nome ?? '',
    numero: contato?.numero ?? numero ?? '',
    observacao: contato?.observacao ?? '',
  });
  const mudar = (chave: keyof typeof campos) => (e: Event) => setCampos({ ...campos, [chave]: (e.currentTarget as HTMLInputElement).value });

  const salvar = (e: Event) => {
    e.preventDefault();
    send({
      cmd: 'saveContact',
      ...(contato ? { id: contato.id } : {}),
      nome: campos.nome,
      numero: campos.numero,
      observacao: campos.observacao,
    });
    onClose();
  };

  return (
    <>
      <BackBar title={contato ? 'Editar contato' : 'Novo contato'} onBack={onClose} />
      <form class="body form scroll" onSubmit={salvar}>
        <div class="field">
          <label class="label" for="contato-nome">
            Nome
          </label>
          <input id="contato-nome" class="input" required autocomplete="off" value={campos.nome} onInput={mudar('nome')} autofocus={!campos.nome} />
        </div>
        <div class="field">
          <label class="label" for="contato-numero">
            Número
          </label>
          <input id="contato-numero" class="input" type="tel" required autocomplete="off" value={campos.numero} onInput={mudar('numero')} />
        </div>
        <div class="field">
          <label class="label" for="contato-obs">
            Observação (opcional)
          </label>
          <input id="contato-obs" class="input" autocomplete="off" placeholder="Ex.: Comercial" value={campos.observacao} onInput={mudar('observacao')} />
        </div>
        <div class="form-actions">
          <button type="submit" class="btn btn-cyan btn-block" style={{ height: '50px' }}>
            Salvar contato
          </button>
        </div>
      </form>
    </>
  );
}
