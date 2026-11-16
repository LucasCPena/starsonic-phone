ALTER TABLE empresas ADD COLUMN reunioes INTEGER NOT NULL DEFAULT 0;
CREATE TABLE reunioes (
  id INTEGER PRIMARY KEY,
  empresa_id INTEGER REFERENCES empresas(id) ON DELETE CASCADE,
  codigo TEXT NOT NULL UNIQUE,
  sala TEXT NOT NULL UNIQUE,
  tipo TEXT NOT NULL CHECK (tipo IN ('marcada', 'naHora', 'teste')),
  assunto TEXT,
  inicio INTEGER,
  vale_ate INTEGER,
  criou_id INTEGER REFERENCES pessoas(id),
  criada_em INTEGER NOT NULL,
  cancelada_em INTEGER,
  acabou_em INTEGER,
  CHECK ((tipo = 'teste') = (empresa_id IS NULL)),
  CHECK (tipo <> 'marcada' OR (inicio IS NOT NULL AND vale_ate IS NOT NULL AND criou_id IS NOT NULL)),
  CHECK (tipo <> 'teste' OR vale_ate IS NOT NULL)
);
CREATE INDEX reunioes_criou ON reunioes(empresa_id, criou_id, inicio);
CREATE TABLE configuracao (chave TEXT PRIMARY KEY, valor TEXT NOT NULL);
