package api

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"os"
	"strconv"
	"strings"
	"time"

	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/armazem"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/banco"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/regras"
	"github.com/LucasCPena/starsonic-phone/chat-servidor/internal/segredo"
)

// Os limites dos arquivos (seção 8 do protocolo).
const (
	maxArquivo      = 26214400  // 25 MB
	maxMiniatura    = 204800    // 200 KiB
	maxArquivosHora = 209715200 // 200 MB por hora, por computador
	periodoArquivos = time.Hour
	// custoMinimoArquivo é o que um arquivo custa, no mínimo, na cota da hora: um arquivo de
	// 1 byte também dá trabalho ao servidor (R15).
	custoMinimoArquivo = 65536
)

// custoArquivo é quanto um arquivo de n bytes gasta da cota de bytes por hora.
func custoArquivo(n int64) int64 {
	return max(n, custoMinimoArquivo)
}

// leitorMarcado guarda o erro que o corpo do pedido deu, para separar o cliente que cortou o
// envio (ou mandou demais) de um erro do disco.
type leitorMarcado struct {
	r   io.Reader
	err error
}

func (l *leitorMarcado) Read(p []byte) (int, error) {
	n, err := l.r.Read(p)
	if err != nil && err != io.EOF {
		l.err = err
	}
	return n, err
}

// idDoArquivo lê o {id} da rota. Um texto que não é um id de arquivo (32 hexadecimais) é um
// id que não existe: responde 404 naoEncontrado e devolve false.
func idDoArquivo(w http.ResponseWriter, r *http.Request) (string, bool) {
	id := r.PathValue("id")
	if !armazem.IDValido(id) {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
		return "", false
	}
	return id, true
}

// nomeDoEnvio lê o X-Arquivo-Nome (percent-encoding de UTF-8) e aplica a regra da seção 3 do
// protocolo. Sem o cabeçalho, ou com um percent-encoding quebrado, o nome é "arquivo".
func nomeDoEnvio(r *http.Request) string {
	nome, err := url.PathUnescape(r.Header.Get("X-Arquivo-Nome"))
	if err != nil {
		nome = ""
	}
	return regras.NomeArquivo(nome)
}

// POST /api/v1/arquivos: guarda os bytes do corpo como um arquivo novo.
func (s *servidor) enviarArquivo(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	// Um Content-Length acima do limite responde logo, sem ler o corpo.
	if r.ContentLength > maxArquivo {
		escreverErro(w, http.StatusRequestEntityTooLarge, "grande", nil)
		return
	}
	nome := nomeDoEnvio(r)
	tipo, _ := regras.TipoArquivo(r.Header.Get("Content-Type"))

	// A cota de bytes por hora é do computador, e o lugar é reservado ANTES de ler o corpo: com
	// o Content-Length, o custo do arquivo; sem ele, o máximo (25 MB). Se o envio falhar, tudo
	// volta; sem Content-Length, quando termina volta o que sobrou da reserva.
	chave := strconv.FormatInt(c.ID, 10)
	reservado := int64(maxArquivo)
	if r.ContentLength >= 0 {
		reservado = custoArquivo(r.ContentLength)
	}
	if ok, esperar := s.arquivosLimite.Usar(chave, int(reservado)); !ok {
		erroEspera(w, "limite", esperar)
		return
	}
	guardado := false
	defer func() {
		if !guardado {
			s.arquivosLimite.Devolver(chave, int(reservado))
		}
	}()

	id := segredo.NovoIDArquivo()
	corpo := &leitorMarcado{r: http.MaxBytesReader(w, r.Body, maxArquivo+1)}
	n, err := s.armazem.Gravar(id, corpo, maxArquivo)
	if err != nil {
		erroDeGravacao(w, err, corpo, "arquivo")
		return
	}
	// Daqui em diante nada mais depende do cliente.
	ctx := context.WithoutCancel(r.Context())
	// A linha só nasce depois de o arquivo estar no disco. Se ela falhar, o arquivo sai.
	a, err := s.banco.CriarArquivo(ctx, id, c.EmpresaID, c.PessoaID, nome, tipo, n)
	if err != nil {
		if err := s.armazem.Apagar(id); err != nil {
			slog.Error("armazem", "erro", err)
		}
		erroDoBanco(w, err)
		return
	}
	guardado = true
	if r.ContentLength < 0 {
		s.arquivosLimite.Devolver(chave, int(reservado-custoArquivo(n)))
	}
	escreverJSON(w, http.StatusCreated, map[string]any{"arquivo": novoArquivoJSON(a)})
}

// PUT /api/v1/arquivos/{id}/miniatura: guarda a miniatura JPEG de uma foto que a pessoa enviou.
func (s *servidor) enviarMiniatura(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoArquivo(w, r)
	if !ok {
		return
	}
	// Só o autor, só numa foto, e antes de ler o corpo.
	a, err := s.banco.ArquivoDoAutor(r.Context(), c.EmpresaID, c.PessoaID, id)
	if err != nil {
		erroDoArquivo(w, err)
		return
	}
	if !a.Foto {
		erroCampo(w, "miniatura")
		return
	}
	if r.ContentLength > maxMiniatura {
		escreverErro(w, http.StatusRequestEntityTooLarge, "grande", nil)
		return
	}
	corpo := &leitorMarcado{r: http.MaxBytesReader(w, r.Body, maxMiniatura+1)}
	// O servidor só confere o começo (FF D8 FF, o marcador do JPEG); nunca decodifica a imagem.
	inicio := make([]byte, 3)
	if _, err := io.ReadFull(corpo, inicio); err != nil || !bytes.Equal(inicio, []byte{0xFF, 0xD8, 0xFF}) {
		erroCampo(w, "miniatura")
		return
	}
	_, err = s.armazem.GravarMiniatura(id, io.MultiReader(bytes.NewReader(inicio), corpo), maxMiniatura)
	if err != nil {
		erroDeGravacao(w, err, corpo, "miniatura")
		return
	}
	if err := s.banco.MarcarMiniatura(context.WithoutCancel(r.Context()), c.PessoaID, id); err != nil {
		// O arquivo expirou (ou sumiu) enquanto o corpo chegava: nenhuma miniatura dele fica no
		// disco, nem a nova nem a que ela trocou.
		// Qualquer outra falha só apaga a miniatura se era a primeira: não deixa uma miniatura
		// sem linha.
		sumiu := errors.Is(err, banco.ErrExpirado) || errors.Is(err, banco.ErrNaoEncontrado)
		if sumiu || !a.Miniatura {
			if err := s.armazem.ApagarMiniatura(id); err != nil {
				slog.Error("armazem", "id", id, "erro", err)
			}
		}
		erroDoArquivo(w, err)
		return
	}
	w.WriteHeader(http.StatusNoContent)
}

// erroDeGravacao responde a uma gravação do corpo que falhou, no envio e na miniatura. campo é
// o nome do corpo na resposta: "arquivo" ou "miniatura". O corpo chega por um io.LimitReader
// de max+1, então todo corpo grande demais chega como armazem.ErrGrande.
func erroDeGravacao(w http.ResponseWriter, err error, corpo *leitorMarcado, campo string) {
	switch {
	case errors.Is(err, armazem.ErrGrande):
		escreverErro(w, http.StatusRequestEntityTooLarge, "grande", nil)
	case corpo.err != nil:
		// O cliente cortou o envio, ou o corpo veio quebrado: não sobrou nada no disco.
		erroCampo(w, campo)
	default:
		slog.Error("armazem", "erro", err)
		erroServidor(w)
	}
}

// erroDoArquivo é o erroDoBanco mais o 410 expirado e o 400 de um arquivo que não aceita
// miniatura.
func erroDoArquivo(w http.ResponseWriter, err error) {
	switch {
	case errors.Is(err, banco.ErrExpirado):
		escreverErro(w, http.StatusGone, "expirado", nil)
	case errors.Is(err, banco.ErrInvalido):
		erroCampo(w, "miniatura")
	default:
		erroDoBanco(w, err)
	}
}

// GET /api/v1/arquivos/{id}: baixa o arquivo, sempre como anexo e sem deixar o navegador
// adivinhar o tipo.
func (s *servidor) baixarArquivo(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoArquivo(w, r)
	if !ok {
		return
	}
	a, err := s.banco.ArquivoParaBaixar(r.Context(), c.EmpresaID, c.PessoaID, id)
	if err != nil {
		erroDoArquivo(w, err)
		return
	}
	f, err := s.armazem.Abrir(id)
	if err != nil {
		s.arquivoSumiu(w, id, err)
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "application/octet-stream")
	h.Set("Content-Disposition", contentDisposition(a.Nome))
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, no-store")
	servirArquivo(w, r, f)
}

// GET /api/v1/arquivos/{id}/miniatura: baixa a miniatura. As regras de quem baixa são as do
// arquivo; sem miniatura, é 404.
func (s *servidor) baixarMiniatura(w http.ResponseWriter, r *http.Request) {
	c, _ := computadorDe(r)
	id, ok := idDoArquivo(w, r)
	if !ok {
		return
	}
	a, err := s.banco.ArquivoParaBaixar(r.Context(), c.EmpresaID, c.PessoaID, id)
	if err != nil {
		erroDoArquivo(w, err)
		return
	}
	if !a.Miniatura {
		escreverErro(w, http.StatusNotFound, "naoEncontrado", nil)
		return
	}
	f, err := s.armazem.AbrirMiniatura(id)
	if err != nil {
		s.arquivoSumiu(w, id, err)
		return
	}
	defer f.Close()
	h := w.Header()
	h.Set("Content-Type", "image/jpeg")
	h.Set("X-Content-Type-Options", "nosniff")
	h.Set("Cache-Control", "private, max-age=86400")
	servirArquivo(w, r, f)
}

// arquivoSumiu responde quando a linha existe e o arquivo não está no disco: é um erro do
// servidor, e o log diz qual id (nunca o nome).
func (s *servidor) arquivoSumiu(w http.ResponseWriter, id string, err error) {
	if errors.Is(err, os.ErrNotExist) {
		slog.Error("arquivo na tabela e fora do disco", "id", id)
	} else {
		slog.Error("armazem", "erro", err)
	}
	erroServidor(w)
}

// servirArquivo manda o conteúdo com o http.ServeContent, que já tem de encontrar o
// Content-Type posto (assim não adivinha o tipo) e atende ao Range. Vários intervalos num
// pedido são atendidos como o arquivo inteiro: a resposta multipart trocaria o Content-Type.
func servirArquivo(w http.ResponseWriter, r *http.Request, f *os.File) {
	if strings.Contains(r.Header.Get("Range"), ",") {
		r.Header.Del("Range")
	}
	http.ServeContent(w, r, "", time.Time{}, f)
}

// contentDisposition monta o Content-Disposition de um anexo: o filename em ASCII (cada
// caractere fora do ASCII, as aspas, a barra invertida e os controles viram "_") e o
// filename* com o nome inteiro em percent-encoding de UTF-8 (RFC 5987).
func contentDisposition(nome string) string {
	var ascii strings.Builder
	for _, r := range nome {
		if r < 0x20 || r > 0x7e || r == '"' || r == '\\' {
			r = '_'
		}
		ascii.WriteRune(r)
	}
	var cod strings.Builder
	for i := 0; i < len(nome); i++ {
		b := nome[i]
		if b >= 'a' && b <= 'z' || b >= 'A' && b <= 'Z' || b >= '0' && b <= '9' || strings.IndexByte("!#$&+-.^_`|~", b) >= 0 {
			cod.WriteByte(b)
		} else {
			fmt.Fprintf(&cod, "%%%02X", b)
		}
	}
	return `attachment; filename="` + ascii.String() + `"; filename*=UTF-8''` + cod.String()
}
