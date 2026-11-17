// As ligações da página com o servidor de vídeo: a principal e a da tela. Por enquanto um esboço, que nunca liga: o
// ligar responde que a ligação falhou, com o código 0 (sem resposta do servidor). As ligações do JsSIP tomam o lugar
// dele, com a mesma interface:
// - criarLigacoes(aoEvento) devolve {ligar, desligar, trocarCamera, trocarMicrofone};
// - ligar({qual, senha, acesso, fluxo}): o qual é 'principal' ou 'tela'; o acesso, o turn e o video do aceito; o fluxo,
//   o MediaStream da câmera e do microfone (o do midia.js). A escolha da pessoa vem nele: a faixa que ela desligou tem
//   o enabled falso, e o aparelho sem acesso não tem faixa (a câmera desligada é a oferta recvonly);
// - as respostas voltam pelo aoEvento: {tipo:'ligacao', qual, o, codigo}, com o o confirmada, falhou, terminou ou
//   semConexao, e {tipo:'cameraTrocada', ok}, a resposta a todo trocarCamera;
// - depois do desligar de uma ligação, nenhum evento dela chega depois do próximo ligar.

/** As ligações do esboço: cada resposta sai no passo seguinte do relógio, como a de uma ligação de verdade. */
export function criarLigacoes(aoEvento) {
  const pendentes = new Map(); // o falhou que ainda vai sair, de cada ligação: o desligar o cancela
  return {
    ligar({ qual }) {
      clearTimeout(pendentes.get(qual));
      const espera = setTimeout(() => {
        pendentes.delete(qual);
        aoEvento({ tipo: 'ligacao', qual, o: 'falhou', codigo: 0 });
      }, 0);
      pendentes.set(qual, espera);
    },
    desligar(qual) {
      clearTimeout(pendentes.get(qual));
      pendentes.delete(qual);
    },
    trocarCamera() {
      setTimeout(() => aoEvento({ tipo: 'cameraTrocada', ok: true }), 0);
    },
    trocarMicrofone() {},
  };
}
