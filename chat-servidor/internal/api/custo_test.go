package api

import "testing"

func TestCustoArquivo(t *testing.T) {
	for _, c := range []struct{ n, quer int64 }{
		{0, 65536},
		{1, 65536},
		{65535, 65536},
		{65536, 65536},
		{65537, 65537},
		{26214400, 26214400},
	} {
		if got := custoArquivo(c.n); got != c.quer {
			t.Errorf("custoArquivo(%d) = %d; queria %d", c.n, got, c.quer)
		}
	}
}
