// Package uso mede a CPU e a memória da VM, lendo o /proc. O resultado vai no estado do agente (seção 5 do
// contrato, docs/video-agente.md).
package uso

import (
	"bufio"
	"errors"
	"fmt"
	"math"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// Uso é o uso da VM, em porcentagem inteira.
type Uso struct {
	CPU     int `json:"cpu"`
	Memoria int `json:"memoria"`
}

// Medidor lê o stat e o meminfo de uma pasta no formato do /proc.
type Medidor struct {
	proc string

	mu        sync.Mutex
	temAntes  bool
	antesOcup uint64
	antesTot  uint64
}

// NovoMedidor cria um Medidor. O proc é a pasta do /proc.
func NovoMedidor(proc string) *Medidor { return &Medidor{proc: proc} }

// Medir lê a VM agora. A CPU é a fração ocupada desde a leitura anterior, e a primeira leitura dá 0. A memória
// é (MemTotal − MemAvailable) / MemTotal.
func (m *Medidor) Medir() (Uso, error) {
	ocupado, total, err := lerCPU(filepath.Join(m.proc, "stat"))
	if err != nil {
		return Uso{}, err
	}
	mem, err := lerMemoria(filepath.Join(m.proc, "meminfo"))
	if err != nil {
		return Uso{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()
	cpu := 0
	if m.temAntes && total > m.antesTot && ocupado >= m.antesOcup {
		cpu = porcento(float64(ocupado-m.antesOcup) / float64(total-m.antesTot))
	}
	m.temAntes, m.antesOcup, m.antesTot = true, ocupado, total
	return Uso{CPU: cpu, Memoria: mem}, nil
}

func porcento(f float64) int {
	p := int(math.Round(f * 100))
	return min(max(p, 0), 100)
}

// lerCPU soma a linha "cpu" do stat: o total são os 8 primeiros campos (o guest já está no user e no nice), e
// o ocupado é o total sem o idle e o iowait.
func lerCPU(caminho string) (ocupado, total uint64, err error) {
	f, err := os.Open(caminho)
	if err != nil {
		return 0, 0, err
	}
	defer f.Close()
	s := bufio.NewScanner(f)
	for s.Scan() {
		campos := strings.Fields(s.Text())
		if len(campos) == 0 || campos[0] != "cpu" {
			continue
		}
		if len(campos) < 9 {
			return 0, 0, errors.New("uso: a linha cpu do stat é curta")
		}
		var v [8]uint64
		for i := range v {
			if v[i], err = strconv.ParseUint(campos[i+1], 10, 64); err != nil {
				return 0, 0, fmt.Errorf("uso: stat: %w", err)
			}
			total += v[i]
		}
		return total - v[3] - v[4], total, nil
	}
	if err := s.Err(); err != nil {
		return 0, 0, err
	}
	return 0, 0, errors.New("uso: o stat não tem a linha cpu")
}

func lerMemoria(caminho string) (int, error) {
	f, err := os.Open(caminho)
	if err != nil {
		return 0, err
	}
	defer f.Close()
	var total, livre uint64
	var temTotal, temLivre bool
	s := bufio.NewScanner(f)
	for s.Scan() {
		nome, resto, ok := strings.Cut(s.Text(), ":")
		if !ok || (nome != "MemTotal" && nome != "MemAvailable") {
			continue
		}
		campos := strings.Fields(resto)
		if len(campos) == 0 {
			return 0, errors.New("uso: meminfo sem valor")
		}
		v, err := strconv.ParseUint(campos[0], 10, 64)
		if err != nil {
			return 0, fmt.Errorf("uso: meminfo: %w", err)
		}
		if nome == "MemTotal" {
			total, temTotal = v, true
		} else {
			livre, temLivre = v, true
		}
	}
	if err := s.Err(); err != nil {
		return 0, err
	}
	if !temTotal || !temLivre || total == 0 {
		return 0, errors.New("uso: o meminfo não tem MemTotal e MemAvailable")
	}
	if livre > total {
		livre = total
	}
	return porcento(float64(total-livre) / float64(total)), nil
}
