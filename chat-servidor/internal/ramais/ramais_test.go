package ramais

import (
	"testing"
	"time"
)

// agora é o instante dos testes: as regras não leem relógio nenhum.
var agora = time.Date(2026, 11, 19, 12, 0, 0, 0, time.UTC)

// dito é o que o app disse há tanto tempo.
func dito(e Estado, ha time.Duration) *Dito {
	return &Dito{Estado: e, Desde: agora.Add(-ha)}
}

func ligado(d *Dito) Visto { return Visto{Ligado: true, Dito: d} }

func TestValido(t *testing.T) {
	for _, e := range []string{"conectado", "conectando", "erro", "semConexao"} {
		if !Valido(e) {
			t.Errorf("Valido(%q) = false; é um dos quatro estados", e)
		}
	}
	for _, e := range []string{"", "Conectado", "sem_conexao", "ok"} {
		if Valido(e) {
			t.Errorf("Valido(%q) = true; não é um estado", e)
		}
	}
}

func TestComputador(t *testing.T) {
	for _, c := range []struct {
		nome   string
		v      Visto
		espera DoComputador
	}{
		{"não ligado, sem dito", Visto{}, PCFora},
		{"não ligado, com um dito conectado", Visto{Dito: dito(Conectado, time.Hour)}, PCFora},
		{"ligado, sem dito", ligado(nil), PCSemDado},
		{"conectado desde agora", ligado(dito(Conectado, 0)), PCRegistrado},
		{"conectado há 2 h", ligado(dito(Conectado, 2*time.Hour)), PCRegistrado},
		{"conectando há 59 s", ligado(dito(Conectando, 59*time.Second)), PCRegistrando},
		{"conectando há 60 s", ligado(dito(Conectando, 60*time.Second)), PCSemRegistro},
		{"erro há 59 s", ligado(dito(Erro, 59*time.Second)), PCRegistrando},
		{"erro há 60 s", ligado(dito(Erro, 60*time.Second)), PCSemRegistro},
		{"semConexao há 59 s", ligado(dito(SemConexao, 59*time.Second)), PCRegistrando},
		{"semConexao há 60 s", ligado(dito(SemConexao, 60*time.Second)), PCSemRegistro},
		// O relógio do servidor andou para trás entre o pedido do app e a página: conta como zero.
		{"erro com o Desde 5 s depois do agora", ligado(dito(Erro, -5*time.Second)), PCRegistrando},
	} {
		if got := Computador(c.v, agora); got != c.espera {
			t.Errorf("%s: Computador = %d; queria %d", c.nome, got, c.espera)
		}
	}
}

func TestDaPessoaCom(t *testing.T) {
	fora := Visto{}
	for _, c := range []struct {
		nome   string
		pcs    []Visto
		espera Pessoa
	}{
		{"nenhum computador", nil, Pessoa{Estado: Offline}},
		{"dois fora", []Visto{fora, fora}, Pessoa{Estado: Offline}},
		{"um registrado há 35 min e um fora", []Visto{ligado(dito(Conectado, 35*time.Minute)), fora},
			Pessoa{Estado: Online, Desde: agora.Add(-35 * time.Minute)}},
		{"dois registrados, há 2 h e há 10 min", []Visto{ligado(dito(Conectado, 10*time.Minute)), ligado(dito(Conectado, 2*time.Hour))},
			Pessoa{Estado: Online, Desde: agora.Add(-2 * time.Hour)}},
		{"um registrado e um sem registro", []Visto{ligado(dito(Erro, 5*time.Minute)), ligado(dito(Conectado, time.Minute))},
			Pessoa{Estado: Online, Desde: agora.Add(-time.Minute)}},
		{"dois sem registro: conectando há 12 min e erro há 3 min",
			[]Visto{ligado(dito(Erro, 3*time.Minute)), ligado(dito(Conectando, 12*time.Minute))},
			Pessoa{Estado: SemRegistro, Desde: agora.Add(-12 * time.Minute), Diz: Conectando}},
		{"um sem registro (erro há 3 min) e um registrando", []Visto{ligado(dito(Conectando, 10*time.Second)), ligado(dito(Erro, 3*time.Minute))},
			Pessoa{Estado: SemRegistro, Desde: agora.Add(-3 * time.Minute), Diz: Erro}},
		{"um registrando e um sem dado", []Visto{ligado(nil), ligado(dito(Conectando, 10*time.Second))},
			Pessoa{Estado: NoChat, Registrando: true}},
		{"só um sem dado", []Visto{ligado(nil)}, Pessoa{Estado: NoChat}},
		{"um sem dado e um fora", []Visto{fora, ligado(nil)}, Pessoa{Estado: NoChat}},
	} {
		if got := DaPessoaCom(c.pcs, agora); got != c.espera {
			t.Errorf("%s: DaPessoaCom = %+v; queria %+v", c.nome, got, c.espera)
		}
	}
}
