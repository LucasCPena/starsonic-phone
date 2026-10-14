#!/usr/bin/env python3
"""Confere se as bibliotecas ELF (.so) estão alinhadas a 16 KB, como o Android 15+ exige.

Lê o cabeçalho ELF e a tabela de programas (só struct, sem binutils, então vale para qualquer
ABI) e olha o alinhamento (p_align) de cada segmento PT_LOAD: tem de ser 16384 ou mais.
Aceita ELF de 32 e 64 bits, little-endian (as três ABIs do app são).

Uso: elf_align.py ARQUIVO.so...
Código 0 = todos alinhados; 1 = algum não está ou não pôde ser lido; 2 = nenhum arquivo informado.
"""
import struct
import sys

PT_LOAD = 1
MIN_ALIGN = 16384          # 16 KB

ELFCLASS32, ELFCLASS64 = 1, 2
ELFDATA2LSB = 1
EI_NIDENT = 16             # e_ident: magic, classe, ordem dos bytes, ...

# Cabeçalho ELF depois do e_ident: e_type, e_machine, e_version, e_entry, e_phoff, e_shoff,
# e_flags, e_ehsize, e_phentsize, e_phnum, e_shentsize, e_shnum, e_shstrndx.
# e_entry, e_phoff e e_shoff têm 4 bytes no ELF32 e 8 no ELF64.
_HEADER = {ELFCLASS32: struct.Struct("<HHIIIIIHHHHHH"), ELFCLASS64: struct.Struct("<HHIQQQIHHHHHH")}
_PHOFF, _PHENTSIZE, _PHNUM = 4, 8, 9      # posições na tupla desempacotada do cabeçalho

# Entrada da tabela de programas. p_flags muda de lugar entre ELF32 e ELF64, mas p_type é
# sempre o primeiro campo e p_align o último.
_PROGRAM = {
    ELFCLASS32: struct.Struct("<IIIIIIII"),   # type offset vaddr paddr filesz memsz flags align
    ELFCLASS64: struct.Struct("<IIQQQQQQ"),   # type flags offset vaddr paddr filesz memsz align
}


def load_alignments(path):
    """Alinhamento (p_align) de cada segmento PT_LOAD do ELF, na ordem da tabela.

    ValueError (com o caminho no texto) se o arquivo não for um ELF little-endian de 32 ou
    64 bits inteiro; OSError se não puder ser lido.
    """
    with open(path, "rb") as handle:
        data = handle.read()
    if len(data) < EI_NIDENT or data[:4] != b"\x7fELF":
        raise ValueError("%s: nao e um arquivo ELF" % path)
    elf_class = data[4]
    if elf_class not in _HEADER:
        raise ValueError("%s: classe ELF %d desconhecida (esperado 32 ou 64 bits)" % (path, elf_class))
    if data[5] != ELFDATA2LSB:
        raise ValueError("%s: ELF big-endian; so little-endian e suportado" % path)
    header, entry = _HEADER[elf_class], _PROGRAM[elf_class]
    if len(data) < EI_NIDENT + header.size:
        raise ValueError("%s: cabecalho ELF truncado" % path)

    fields = header.unpack_from(data, EI_NIDENT)
    phoff, phentsize, phnum = fields[_PHOFF], fields[_PHENTSIZE], fields[_PHNUM]
    if phnum and phentsize < entry.size:
        raise ValueError("%s: entrada da tabela de programas com %d bytes (minimo %d)" % (path, phentsize, entry.size))
    alignments = []
    for index in range(phnum):
        start = phoff + index * phentsize
        if start + entry.size > len(data):
            raise ValueError("%s: tabela de programas truncada (entrada %d de %d)" % (path, index + 1, phnum))
        values = entry.unpack_from(data, start)
        if values[0] == PT_LOAD:
            alignments.append(values[-1])
    return alignments


def main(paths):
    if not paths:
        print("uso: elf_align.py ARQUIVO.so...", file=sys.stderr)
        return 2
    failed = 0
    for path in paths:
        try:
            alignments = load_alignments(path)
        except (ValueError, OSError) as error:
            print("elf_align: %s" % error, file=sys.stderr)
            failed += 1
            continue
        shown = ", ".join(str(value) for value in alignments)
        if not alignments:
            print("%s: sem segmentos PT_LOAD (nao e uma biblioteca carregavel)" % path)
            failed += 1
        elif min(alignments) < MIN_ALIGN:
            print("%s: PT_LOAD com alinhamento %s (precisa de %d ou mais)" % (path, shown, MIN_ALIGN))
            failed += 1
        else:
            print("ok: %s: PT_LOAD alinhados a %s (16 KB ou mais)" % (path, shown))
    if failed:
        print("elf_align: %d de %d arquivo(s) sem alinhamento de 16 KB" % (failed, len(paths)), file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
