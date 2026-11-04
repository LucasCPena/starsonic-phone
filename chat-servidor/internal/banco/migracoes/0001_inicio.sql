CREATE TABLE empresas (
  id INTEGER PRIMARY KEY AUTOINCREMENT, nome TEXT NOT NULL, codigo TEXT NOT NULL UNIQUE, criada_em INTEGER NOT NULL
);
CREATE TABLE pessoas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  ramal TEXT NOT NULL, nome TEXT NOT NULL, nome_busca TEXT NOT NULL,
  entrou_em INTEGER NOT NULL, saiu_em INTEGER
);
CREATE UNIQUE INDEX pessoas_ramal_ativo ON pessoas(empresa_id, ramal) WHERE saiu_em IS NULL;
CREATE TABLE computadores (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  chave_hash BLOB NOT NULL UNIQUE, nome TEXT NOT NULL,
  pessoa_id INTEGER REFERENCES pessoas(id),
  ligado_em INTEGER NOT NULL, ultima_vez INTEGER NOT NULL, saiu_em INTEGER
);
CREATE TABLE computador_pessoas (
  computador_id INTEGER NOT NULL REFERENCES computadores(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  primeira_vez INTEGER NOT NULL, ultima_vez INTEGER NOT NULL,
  PRIMARY KEY (computador_id, pessoa_id)
);
CREATE TABLE conversas (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  tipo TEXT NOT NULL CHECK (tipo IN ('dupla', 'grupo')),
  nome TEXT, cuida_id INTEGER REFERENCES pessoas(id), criou_id INTEGER REFERENCES pessoas(id),
  dupla_a INTEGER REFERENCES pessoas(id), dupla_b INTEGER REFERENCES pessoas(id),
  criada_em INTEGER NOT NULL, atualizada_em INTEGER NOT NULL,
  CHECK ((tipo = 'dupla' AND dupla_a < dupla_b AND nome IS NULL)
      OR (tipo = 'grupo' AND dupla_a IS NULL AND dupla_b IS NULL AND nome IS NOT NULL))
);
CREATE UNIQUE INDEX conversas_dupla ON conversas(empresa_id, dupla_a, dupla_b) WHERE tipo = 'dupla';
CREATE TABLE membros (
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  entrou_em INTEGER NOT NULL, saiu_em INTEGER,
  PRIMARY KEY (conversa_id, pessoa_id)
);
CREATE TABLE arquivos (
  id TEXT PRIMARY KEY,
  empresa_id INTEGER NOT NULL REFERENCES empresas(id) ON DELETE CASCADE,
  autor_id INTEGER NOT NULL REFERENCES pessoas(id),
  nome TEXT NOT NULL, tipo TEXT NOT NULL, tamanho INTEGER NOT NULL,
  miniatura INTEGER NOT NULL DEFAULT 0, criado_em INTEGER NOT NULL, expirado_em INTEGER
);
CREATE TABLE mensagens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  autor_id INTEGER REFERENCES pessoas(id),
  tipo TEXT NOT NULL CHECK (tipo IN ('texto', 'arquivo', 'aviso')),
  texto TEXT, arquivo_id TEXT UNIQUE REFERENCES arquivos(id),
  aviso_acao TEXT CHECK (aviso_acao IN ('criou', 'pos', 'tirou', 'saiu')),
  aviso_alvo_id INTEGER REFERENCES pessoas(id),
  id_local TEXT, criada_em INTEGER NOT NULL
);
CREATE UNIQUE INDEX mensagens_id_local ON mensagens(autor_id, id_local) WHERE id_local IS NOT NULL;
CREATE INDEX mensagens_conversa ON mensagens(conversa_id, id);
CREATE TABLE leituras (
  pessoa_id INTEGER NOT NULL REFERENCES pessoas(id) ON DELETE CASCADE,
  conversa_id INTEGER NOT NULL REFERENCES conversas(id) ON DELETE CASCADE,
  ate INTEGER NOT NULL,
  PRIMARY KEY (pessoa_id, conversa_id)
);
CREATE TABLE admins (
  usuario TEXT PRIMARY KEY, senha_hash TEXT NOT NULL, criado_em INTEGER NOT NULL
);
CREATE TABLE sessoes_admin (
  token_hash BLOB PRIMARY KEY,
  usuario TEXT NOT NULL REFERENCES admins(usuario) ON DELETE CASCADE,
  csrf TEXT NOT NULL, expira_em INTEGER NOT NULL
);
