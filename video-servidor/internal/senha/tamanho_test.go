package senha

// Tamanho é quantos ids o UsoUnico guarda. Só os testes usam.
func (u *UsoUnico) Tamanho() int {
	u.mu.Lock()
	defer u.mu.Unlock()
	return len(u.ids)
}
