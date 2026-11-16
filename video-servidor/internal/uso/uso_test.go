package uso

import (
	"os"
	"path/filepath"
	"testing"
)

func escrever(t *testing.T, proc, nome, texto string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(proc, nome), []byte(texto), 0o644); err != nil {
		t.Fatal(err)
	}
}

func TestUso(t *testing.T) {
	proc := t.TempDir()
	escrever(t, proc, "meminfo", "MemTotal:        8000000 kB\nMemFree:          100000 kB\nMemAvailable:    6000000 kB\n")
	// user nice system idle iowait irq softirq steal guest guestnice: 1.000 no total, 100 de CPU ocupada.
	escrever(t, proc, "stat", "cpu  50 0 50 850 50 0 0 0 0 0\ncpu0 1 2 3 4 5 6 7 8 9 10\n")
	m := NovoMedidor(proc)

	u, err := m.Medir()
	if err != nil {
		t.Fatal(err)
	}
	if u.CPU != 0 {
		t.Fatalf("a primeira leitura deu CPU %d; queria 0", u.CPU)
	}
	if u.Memoria != 25 {
		t.Fatalf("memória %d; queria 25", u.Memoria)
	}

	// Entre as leituras, 1.000 a mais no total, 300 ocupados (o idle e o iowait não contam).
	escrever(t, proc, "stat", "cpu  250 0 150 1500 100 0 0 0 0 0\n")
	u, err = m.Medir()
	if err != nil {
		t.Fatal(err)
	}
	if u.CPU != 30 {
		t.Fatalf("CPU %d; queria 30", u.CPU)
	}

	// Sem tempo novo, a CPU é 0 e não divide por zero.
	u, err = m.Medir()
	if err != nil || u.CPU != 0 {
		t.Fatalf("sem tempo novo: %+v, %v", u, err)
	}
}

func TestUso_Arredonda(t *testing.T) {
	proc := t.TempDir()
	escrever(t, proc, "meminfo", "MemTotal: 3 kB\nMemAvailable: 2 kB\n") // 33,3%
	escrever(t, proc, "stat", "cpu  0 0 0 0 0 0 0 0 0 0\n")
	m := NovoMedidor(proc)
	u, err := m.Medir()
	if err != nil || u.Memoria != 33 {
		t.Fatalf("%+v, %v", u, err)
	}
	escrever(t, proc, "meminfo", "MemTotal: 3 kB\nMemAvailable: 1 kB\n") // 66,7%
	u, _ = m.Medir()
	if u.Memoria != 67 {
		t.Fatalf("memória %d; queria 67", u.Memoria)
	}
}

func TestUso_Erros(t *testing.T) {
	if _, err := NovoMedidor(t.TempDir()).Medir(); err == nil {
		t.Fatal("sem os arquivos, queria um erro")
	}
	proc := t.TempDir()
	escrever(t, proc, "meminfo", "MemTotal: 0 kB\nMemAvailable: 0 kB\n")
	escrever(t, proc, "stat", "cpu  1 2 3 4 5 6 7 8\n")
	if _, err := NovoMedidor(proc).Medir(); err == nil {
		t.Fatal("com MemTotal zero, queria um erro")
	}
}
