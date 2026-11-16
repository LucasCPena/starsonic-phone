package salas

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/LucasCPena/starsonic-phone/video-servidor/internal/esl"
)

// Os nomes são inventados: as salas e os participantes são hexadecimais de teste.
const (
	salaA = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"
	salaB = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"

	anaID    = "a1a1a1a1a1a1a1a1"
	carlosID = "c2c2c2c2c2c2c2c2"
	biaID    = "b3b3b3b3b3b3b3b3"

	uuidAnaCamera   = "00000000-0000-4000-8000-0000000000a1"
	uuidAnaTela     = "00000000-0000-4000-8000-0000000000a2"
	uuidCarlosCam   = "00000000-0000-4000-8000-0000000000c1"
	uuidCarlosTela  = "00000000-0000-4000-8000-0000000000c2"
	uuidBiaCamera   = "00000000-0000-4000-8000-0000000000b1"
	grupoSemTela    = "conference " + salaA + " vid-layout group starsonic-grade"
	layoutApresenta = "conference " + salaA + " vid-layout starsonic-apresentacao"
)

// apiFalsa guarda os comandos e responde pelo que foi combinado.
type apiFalsa struct {
	mu        sync.Mutex
	comandos  []string
	respostas map[string]string
	erros     map[string]error
	durante   func() // roda a cada comando, fora do mutex da apiFalsa
}

func novaAPI() *apiFalsa {
	return &apiFalsa{respostas: map[string]string{}, erros: map[string]error{}}
}

func (a *apiFalsa) API(ctx context.Context, comando string) (string, error) {
	a.mu.Lock()
	a.comandos = append(a.comandos, comando)
	resp, ok := a.respostas[comando]
	err := a.erros[comando]
	durante := a.durante
	a.mu.Unlock()
	if durante != nil {
		durante()
	}
	if err != nil {
		return "", err
	}
	if !ok {
		return "+OK\n", nil
	}
	return resp, nil
}

func (a *apiFalsa) Comandos() []string {
	a.mu.Lock()
	defer a.mu.Unlock()
	return append([]string(nil), a.comandos...)
}

func (a *apiFalsa) Limpar() {
	a.mu.Lock()
	defer a.mu.Unlock()
	a.comandos = nil
}

type avisos struct {
	mu    sync.Mutex
	lista []Aviso
}

func (v *avisos) Avisar(a Aviso) {
	v.mu.Lock()
	defer v.mu.Unlock()
	v.lista = append(v.lista, a)
}

func (v *avisos) Lista() []Aviso {
	v.mu.Lock()
	defer v.mu.Unlock()
	return append([]Aviso(nil), v.lista...)
}

func entra(sala, uuid, participante string, tela bool) esl.Evento {
	return esl.Evento{
		"Event-Name":                      "CUSTOM",
		"Event-Subclass":                  "conference::maintenance",
		"Action":                          "add-member",
		"Conference-Name":                 sala,
		"Unique-ID":                       uuid,
		"variable_starsonic_participante": participante,
		"variable_starsonic_tela":         fmt.Sprint(tela),
	}
}

func sai(sala, uuid string) esl.Evento {
	return esl.Evento{
		"Event-Name":      "CUSTOM",
		"Event-Subclass":  "conference::maintenance",
		"Action":          "del-member",
		"Conference-Name": sala,
		"Unique-ID":       uuid,
	}
}

func acaba(sala string) esl.Evento {
	return esl.Evento{
		"Event-Name":      "CUSTOM",
		"Event-Subclass":  "conference::maintenance",
		"Action":          "conference-destroy",
		"Conference-Name": sala,
	}
}

func novo(t *testing.T) (*Salas, *apiFalsa, *avisos) {
	t.Helper()
	v := &avisos{}
	s := Nova(v.Avisar)
	a := novaAPI()
	s.Ligar(a)
	return s, a, v
}

func ctx() context.Context { return context.Background() }

func TestSalas_EntrouSaiu(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}, {carlosID, false}}}}
	if got := s.Estado(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado = %+v, want %+v", got, want)
	}
	s.Evento(ctx(), sai(salaA, uuidAnaCamera))
	want = []Sala{{Sala: salaA, Participantes: []Participante{{carlosID, false}}}}
	if got := s.Estado(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado depois da saída = %+v, want %+v", got, want)
	}
	avisosWant := []Aviso{
		{Tipo: "entrou", Sala: salaA, Participante: anaID},
		{Tipo: "entrou", Sala: salaA, Participante: carlosID},
		{Tipo: "saiu", Sala: salaA, Participante: anaID},
	}
	if got := v.Lista(); !reflect.DeepEqual(got, avisosWant) {
		t.Errorf("avisos = %+v, want %+v", got, avisosWant)
	}
}

func TestSalas_Estado(t *testing.T) {
	t.Run("sem salas é uma lista vazia, e não nula", func(t *testing.T) {
		s, _, _ := novo(t)
		got := s.Estado()
		if got == nil || len(got) != 0 {
			t.Fatalf("Estado = %#v, want lista vazia", got)
		}
		b, _ := json.Marshal(got)
		if string(b) != "[]" {
			t.Errorf("JSON = %s, want []", b)
		}
	})
	t.Run("o JSON é o da seção 5 do contrato, em ordem estável", func(t *testing.T) {
		s, _, _ := novo(t)
		s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
		s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
		s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		b, _ := json.Marshal(s.Estado())
		want := fmt.Sprintf(`[{"sala":%q,"participantes":[{"participante":%q,"tela":false},{"participante":%q,"tela":false},{"participante":%q,"tela":true}]},{"sala":%q,"participantes":[{"participante":%q,"tela":false}]}]`,
			salaA, anaID, carlosID, carlosID, salaB, biaID)
		if string(b) != want {
			t.Errorf("JSON =\n%s\nwant\n%s", b, want)
		}
	})
	t.Run("o resultado é uma cópia", func(t *testing.T) {
		s, _, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		e := s.Estado()
		e[0].Participantes[0].Participante = "mexido"
		if got := s.Estado()[0].Participantes[0].Participante; got != anaID {
			t.Errorf("o Estado mudou por fora: %s", got)
		}
	})
}

func TestSalas_Tela(t *testing.T) {
	s, a, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	if got := a.Comandos(); len(got) != 0 {
		t.Fatalf("as câmeras mandaram comandos: %q", got)
	}

	passos := []struct {
		nome   string
		evento esl.Evento
		want   []string
	}{
		{"a tela de Ana entra", entra(salaA, uuidAnaTela, anaID, true), []string{layoutApresenta}},
		{"a tela de Carlos toma o lugar", entra(salaA, uuidCarlosTela, carlosID, true), []string{"uuid_kill " + uuidAnaTela}},
		{"a de Ana sai", sai(salaA, uuidAnaTela), nil},
		{"a de Carlos sai", sai(salaA, uuidCarlosTela), []string{grupoSemTela}},
	}
	for _, p := range passos {
		a.Limpar()
		s.Evento(ctx(), p.evento)
		if got := a.Comandos(); !reflect.DeepEqual(got, p.want) {
			t.Errorf("%s: comandos = %q, want %q", p.nome, got, p.want)
		}
	}
	telas := 0
	for _, av := range v.Lista() {
		if av.Tela {
			telas++
		}
	}
	if telas != 4 {
		t.Errorf("os avisos da tela: %d, want 4 (2 entrou e 2 saiu): %+v", telas, v.Lista())
	}
	want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}, {carlosID, false}}}}
	if got := s.Estado(); !reflect.DeepEqual(got, want) {
		t.Errorf("Estado = %+v, want %+v", got, want)
	}
}

func TestSalas_Tela_SemFreeSWITCH(t *testing.T) {
	// Sem a ligação o evento só acompanha o estado: nenhum comando, nenhum pânico.
	s := Nova(nil)
	s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	s.Evento(ctx(), sai(salaA, uuidAnaTela))
	if got := s.Estado(); len(got) != 1 || len(got[0].Participantes) != 0 {
		t.Errorf("Estado = %+v", got)
	}
}

func TestSalas_TirarEncerrar(t *testing.T) {
	t.Run("o Tirar de quem tem câmera e tela manda os dois uuid_kill", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
		s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
		a.Limpar()
		if err := s.Tirar(ctx(), salaA, anaID); err != nil {
			t.Fatal(err)
		}
		got := a.Comandos()
		want := []string{"uuid_kill " + uuidAnaCamera, "uuid_kill " + uuidAnaTela}
		if len(got) != 2 || !(got[0] == want[0] && got[1] == want[1] || got[0] == want[1] && got[1] == want[0]) {
			t.Errorf("comandos = %q, want %q", got, want)
		}
		// O estado só muda quando o FreeSWITCH avisa que saiu.
		if n := len(s.Estado()[0].Participantes); n != 3 {
			t.Errorf("o Tirar mexeu no estado: %d ligações", n)
		}
	})
	t.Run("um participante desconhecido dá ErrNaoEncontrado, sem comando", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.Limpar()
		if err := s.Tirar(ctx(), salaA, biaID); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("participante desconhecido: err = %v", err)
		}
		if err := s.Tirar(ctx(), salaB, anaID); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("sala desconhecida: err = %v", err)
		}
		if got := a.Comandos(); len(got) != 0 {
			t.Errorf("comandos = %q, want nenhum", got)
		}
	})
	t.Run("o Encerrar manda conference <sala> hup all", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.Limpar()
		if err := s.Encerrar(ctx(), salaA); err != nil {
			t.Fatal(err)
		}
		if got, want := a.Comandos(), []string{"conference " + salaA + " hup all"}; !reflect.DeepEqual(got, want) {
			t.Errorf("comandos = %q, want %q", got, want)
		}
	})
	t.Run("o Encerrar de uma sala desconhecida dá ErrNaoEncontrado, sem comando", func(t *testing.T) {
		s, a, _ := novo(t)
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrNaoEncontrado) {
			t.Errorf("err = %v, want ErrNaoEncontrado", err)
		}
		if got := a.Comandos(); len(got) != 0 {
			t.Errorf("comandos = %q, want nenhum", got)
		}
	})
	t.Run("sem o Ligar, os dois dão ErrSemFreeSWITCH", func(t *testing.T) {
		s := Nova(nil)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		if err := s.Tirar(ctx(), salaA, anaID); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Tirar: err = %v", err)
		}
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Encerrar: err = %v", err)
		}
	})
	t.Run("o Ligar com nil, quando o ESL cai, volta a ErrSemFreeSWITCH", func(t *testing.T) {
		s, _, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Ligar(nil)
		if err := s.Tirar(ctx(), salaA, anaID); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Tirar: err = %v", err)
		}
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Encerrar: err = %v", err)
		}
	})
	t.Run("o ESL desligado no meio vira ErrSemFreeSWITCH", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.erros["uuid_kill "+uuidAnaCamera] = esl.ErrDesligado
		a.erros["conference "+salaA+" hup all"] = esl.ErrDesligado
		if err := s.Tirar(ctx(), salaA, anaID); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Tirar: err = %v", err)
		}
		if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("Encerrar: err = %v", err)
		}
	})
	t.Run("um erro do FreeSWITCH volta ao chamador", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		a.erros["uuid_kill "+uuidAnaCamera] = errors.New("esl: no such channel")
		err := s.Tirar(ctx(), salaA, anaID)
		if err == nil || errors.Is(err, ErrNaoEncontrado) || errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v, want o erro do FreeSWITCH", err)
		}
	})
}

func TestSalas_Acabou(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	s.Evento(ctx(), acaba(salaA))
	want := []Sala{{Sala: salaB, Participantes: []Participante{{biaID, false}}}}
	if got := s.Estado(); !reflect.DeepEqual(got, want) {
		t.Errorf("Estado = %+v, want %+v", got, want)
	}
	lista := v.Lista()
	if got := lista[len(lista)-1]; got != (Aviso{Tipo: "acabou", Sala: salaA}) {
		t.Errorf("último aviso = %+v", got)
	}
	// A sala que acabou não aceita mais o Encerrar.
	if err := s.Encerrar(ctx(), salaA); !errors.Is(err, ErrNaoEncontrado) {
		t.Errorf("Encerrar depois do fim: err = %v", err)
	}
}

func TestSalas_IgnoraOutras(t *testing.T) {
	casos := []struct {
		nome   string
		evento esl.Evento
	}{
		{"conferência com outro nome", entra("sala-de-outra-coisa", uuidAnaCamera, anaID, false)},
		{"nome com maiúsculas", entra(strings.ToUpper(salaA), uuidAnaCamera, anaID, false)},
		{"nome comprido", entra(salaA+"00", uuidAnaCamera, anaID, false)},
		{"sem participante", entra(salaA, uuidAnaCamera, "", false)},
		{"participante que não é hexadecimal", entra(salaA, uuidAnaCamera, "../../etc/passwd", false)},
		{"sem uuid", entra(salaA, "", anaID, false)},
		{"uuid com espaço", entra(salaA, "x y", anaID, false)},
		{"subclasse de outra coisa", func() esl.Evento {
			e := entra(salaA, uuidAnaCamera, anaID, false)
			e["Event-Subclass"] = "sofia::register"
			return e
		}()},
		{"outra ação", func() esl.Evento {
			e := entra(salaA, uuidAnaCamera, anaID, false)
			e["Action"] = "mute-member"
			return e
		}()},
		{"saída de quem não se conhece", sai(salaA, uuidAnaCamera)},
		{"fim de outra conferência", acaba("sala-de-outra-coisa")},
		{"evento vazio", esl.Evento{}},
	}
	for _, c := range casos {
		t.Run(c.nome, func(t *testing.T) {
			s, a, v := novo(t)
			s.Evento(ctx(), c.evento)
			if got := s.Estado(); len(got) != 0 {
				t.Errorf("Estado = %+v, want vazio", got)
			}
			if got := v.Lista(); len(got) != 0 {
				t.Errorf("avisos = %+v, want nenhum", got)
			}
			if got := a.Comandos(); len(got) != 0 {
				t.Errorf("comandos = %q, want nenhum", got)
			}
		})
	}
}

func TestSalas_EntradaRepetida(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	if got := len(v.Lista()); got != 1 {
		t.Errorf("avisos = %d, want 1", got)
	}
	if n := len(s.Estado()[0].Participantes); n != 1 {
		t.Errorf("ligações = %d, want 1", n)
	}
}

func TestSalas_Esvaziar(t *testing.T) {
	s, _, v := novo(t)
	s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	s.Evento(ctx(), entra(salaA, uuidCarlosCam, carlosID, false))
	antes := len(v.Lista())
	s.Esvaziar()
	got := v.Lista()[antes:]
	want := []Aviso{{Tipo: "acabou", Sala: salaA}, {Tipo: "acabou", Sala: salaB}}
	if !reflect.DeepEqual(got, want) {
		t.Errorf("avisos do Esvaziar = %+v, want %+v", got, want)
	}
	if e := s.Estado(); len(e) != 0 {
		t.Errorf("Estado = %+v, want vazio", e)
	}
	s.Esvaziar() // de novo: nada a avisar
	if n := len(v.Lista()); n != antes+2 {
		t.Errorf("o segundo Esvaziar avisou de novo: %d avisos", n)
	}
}

// listaFS monta o conference json_list como o FreeSWITCH o escreve, com os campos que o agente não usa.
func listaFS(salas map[string][]string, ordem []string) string {
	var confs []map[string]any
	for _, nome := range ordem {
		var membros []map[string]any
		for i, u := range salas[nome] {
			membros = append(membros, map[string]any{"id": i + 1, "uuid": u, "caller_id_name": "Ana", "flags": map[string]any{"can_hear": true}})
		}
		confs = append(confs, map[string]any{"conference_name": nome, "member_count": len(membros), "running": true, "members": membros})
	}
	b, _ := json.MarshalIndent(confs, "", "    ")
	return string(b)
}

func TestSalas_Reconstruir(t *testing.T) {
	// O estado de antes do reinício do agente, montado pelos eventos.
	antes, _, _ := novo(t)
	antes.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
	antes.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
	antes.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
	want := antes.Estado()
	if len(want) != 2 {
		t.Fatalf("o preparo falhou: %+v", want)
	}

	// O agente reinicia: o FreeSWITCH continua com as duas salas e as três ligações.
	s := Nova(nil)
	a := novaAPI()
	a.respostas["conference json_list"] = listaFS(map[string][]string{
		salaA: {uuidAnaCamera, uuidAnaTela},
		salaB: {uuidBiaCamera},
	}, []string{salaA, salaB})
	for uuid, p := range map[string][2]string{
		uuidAnaCamera: {anaID, "false"}, uuidAnaTela: {anaID, "true"}, uuidBiaCamera: {biaID, "false"},
	} {
		a.respostas["uuid_getvar "+uuid+" starsonic_participante"] = p[0]
		a.respostas["uuid_getvar "+uuid+" starsonic_tela"] = p[1]
	}
	s.Ligar(a)
	if err := s.Reconstruir(ctx()); err != nil {
		t.Fatal(err)
	}
	if got := s.Estado(); !reflect.DeepEqual(got, want) {
		t.Fatalf("Estado = %+v, want %+v", got, want)
	}
	cmds := a.Comandos()
	if cmds[0] != "conference json_list" || len(cmds) != 1+3*2 {
		t.Errorf("comandos = %q", cmds)
	}

	// E o Tirar acha os uuids.
	a.Limpar()
	if err := s.Tirar(ctx(), salaA, anaID); err != nil {
		t.Fatal(err)
	}
	got := a.Comandos()
	if len(got) != 2 {
		t.Fatalf("Tirar mandou %q", got)
	}
	vistos := map[string]bool{got[0]: true, got[1]: true}
	if !vistos["uuid_kill "+uuidAnaCamera] || !vistos["uuid_kill "+uuidAnaTela] {
		t.Errorf("Tirar mandou %q", got)
	}
	// E uma tela nova depois da volta toma o lugar da que já estava.
	a.Limpar()
	s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
	if got := a.Comandos(); !reflect.DeepEqual(got, []string{"uuid_kill " + uuidAnaTela}) {
		t.Errorf("tela nova depois da volta: comandos = %q", got)
	}
}

func TestSalas_Reconstruir_SemConferencias(t *testing.T) {
	// O FreeSWITCH escreve o "[]" (o json_list, em mod_conference/conference_api.c) e, em outros caminhos de
	// listagem, o "+OK No active conferences.". As duas respostas são uma lista vazia.
	respostas := map[string]string{
		"array vazio":                  "[]",
		"array vazio formatado":        "[\n]\n",
		"array vazio com espaços":      "  [ ]  \n",
		"texto sem conferências":       "+OK No active conferences.\n",
		"texto sem conferências, cru":  "+OK No active conferences.",
		"resposta vazia":               "",
		"resposta só com quebra":       "\n",
		"salas de outro nome e vazias": `[{"conference_name":"outra","members":[{"uuid":"x"}]},{"conference_name":"` + salaA + `","members":[]}]`,
	}
	for nome, resp := range respostas {
		t.Run(nome, func(t *testing.T) {
			s := Nova(nil)
			a := novaAPI()
			a.respostas["conference json_list"] = resp
			s.Ligar(a)
			if err := s.Reconstruir(ctx()); err != nil {
				t.Fatalf("Reconstruir: %v", err)
			}
			if got := s.Estado(); len(got) != 0 {
				t.Errorf("Estado = %+v, want vazio", got)
			}
			if cmds := a.Comandos(); len(cmds) != 1 {
				t.Errorf("comandos = %q, want só o json_list", cmds)
			}
		})
	}
}

func TestSalas_Reconstruir_Erros(t *testing.T) {
	t.Run("sem o Ligar", func(t *testing.T) {
		if err := Nova(nil).Reconstruir(ctx()); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("uma resposta que não é JSON nem a de sem conferências", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.respostas["conference json_list"] = "<html>outra coisa</html>"
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err == nil {
			t.Error("Reconstruir aceitou uma resposta ilegível")
		}
	})
	t.Run("o json_list com erro", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.erros["conference json_list"] = errors.New("esl: boom")
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err == nil || errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("o ESL desligado vira ErrSemFreeSWITCH", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.erros["conference json_list"] = esl.ErrDesligado
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); !errors.Is(err, ErrSemFreeSWITCH) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("uma ligação que sumiu ou não é nossa fica de fora, as outras entram", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		const uuidSumiu, uuidDeFora = "00000000-0000-4000-8000-000000000001", "00000000-0000-4000-8000-000000000002"
		a.respostas["conference json_list"] = listaFS(map[string][]string{salaA: {uuidSumiu, uuidDeFora, uuidAnaCamera}}, []string{salaA})
		a.erros["uuid_getvar "+uuidSumiu+" starsonic_participante"] = errors.New("esl: no such channel")
		a.respostas["uuid_getvar "+uuidDeFora+" starsonic_participante"] = "_undef_"
		a.respostas["uuid_getvar "+uuidAnaCamera+" starsonic_participante"] = anaID
		a.respostas["uuid_getvar "+uuidAnaCamera+" starsonic_tela"] = "_undef_" // a câmera sem a variável da tela
		s.Ligar(a)
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		want := []Sala{{Sala: salaA, Participantes: []Participante{{anaID, false}}}}
		if got := s.Estado(); !reflect.DeepEqual(got, want) {
			t.Errorf("Estado = %+v, want %+v", got, want)
		}
	})
	t.Run("o contexto cancelado interrompe", func(t *testing.T) {
		s := Nova(nil)
		a := novaAPI()
		a.respostas["conference json_list"] = listaFS(map[string][]string{salaA: {uuidAnaCamera}}, []string{salaA})
		a.erros["uuid_getvar "+uuidAnaCamera+" starsonic_participante"] = context.Canceled
		s.Ligar(a)
		c, cancel := context.WithCancel(ctx())
		cancel()
		if err := s.Reconstruir(c); !errors.Is(err, context.Canceled) {
			t.Errorf("err = %v", err)
		}
	})
	t.Run("não apaga o que os eventos já trouxeram", func(t *testing.T) {
		s, a, _ := novo(t)
		s.Evento(ctx(), entra(salaB, uuidBiaCamera, biaID, false))
		a.respostas["conference json_list"] = "[]"
		if err := s.Reconstruir(ctx()); err != nil {
			t.Fatal(err)
		}
		if got := s.Estado(); len(got) != 1 {
			t.Errorf("Estado = %+v", got)
		}
	})
}

// Nenhum comando ao FreeSWITCH, nem aviso, sai com o mutex das salas preso: a apiFalsa e o avisar chamam o
// Estado, que travaria.
func TestSalas_ComandosForaDoMutex(t *testing.T) {
	var s *Salas
	var a *apiFalsa
	chamadas := 0
	avisar := func(Aviso) { s.Estado() }
	s = Nova(avisar)
	a = novaAPI()
	a.durante = func() { chamadas++; s.Estado() }
	s.Ligar(a)

	feito := make(chan struct{})
	go func() {
		defer close(feito)
		s.Evento(ctx(), entra(salaA, uuidAnaCamera, anaID, false))
		s.Evento(ctx(), entra(salaA, uuidAnaTela, anaID, true))
		s.Evento(ctx(), entra(salaA, uuidCarlosTela, carlosID, true))
		s.Evento(ctx(), sai(salaA, uuidAnaTela))
		s.Evento(ctx(), sai(salaA, uuidCarlosTela))
		_ = s.Tirar(ctx(), salaA, anaID)
		_ = s.Encerrar(ctx(), salaA)
		a.respostas["conference json_list"] = listaFS(map[string][]string{salaB: {uuidBiaCamera}}, []string{salaB})
		a.respostas["uuid_getvar "+uuidBiaCamera+" starsonic_participante"] = biaID
		a.respostas["uuid_getvar "+uuidBiaCamera+" starsonic_tela"] = "false"
		_ = s.Reconstruir(ctx())
		s.Esvaziar()
		s.Evento(ctx(), acaba(salaA))
	}()
	select {
	case <-feito:
	case <-time.After(5 * time.Second):
		t.Fatal("travou: um comando ou um aviso saiu com o mutex preso")
	}
	if chamadas == 0 {
		t.Error("a apiFalsa não foi chamada")
	}
}

func TestSalas_Concorrencia(t *testing.T) {
	s, _, _ := novo(t)
	var wg sync.WaitGroup
	for i := 0; i < 8; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			uuid := fmt.Sprintf("00000000-0000-4000-8000-%012d", i)
			part := fmt.Sprintf("%016x", i+1)
			for j := 0; j < 50; j++ {
				s.Evento(ctx(), entra(salaA, uuid, part, j%2 == 0))
				s.Estado()
				_ = s.Tirar(ctx(), salaA, part)
				s.Evento(ctx(), sai(salaA, uuid))
			}
		}()
	}
	wg.Wait()
	if e := s.Estado(); len(e) != 1 || len(e[0].Participantes) != 0 {
		t.Errorf("Estado = %+v", e)
	}
}
