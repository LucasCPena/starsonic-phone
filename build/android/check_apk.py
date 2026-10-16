#!/usr/bin/env python3
"""Confere o APK do Starsonic Phone antes de publicar (spec 11.2 e 9.5).

- Bibliotecas: lib/<abi>/libstarsonic.so, liboboe.so e libc++_shared.so em cada ABI pedida, e nenhuma outra ABI.
- 16 KB: toda .so das ABIs de 64 bits (arm64-v8a e x86_64) com os segmentos PT_LOAD alinhados a 16 KB ou mais
  (elf_align.py) e, se guardada sem compressão, começando num múltiplo de 16 KB dentro do zip. As de 32 bits ficam de
  fora (ruling da Task 5: a libc++_shared.so do NDK para armeabi-v7a vem com 4 KB, e celular de 32 bits usa páginas
  de 4 KB).
- Nenhum "MicroSIP" (exato, em UTF-8 ou UTF-16LE) no nome ou no conteúdo de nenhum arquivo do APK.
- O perfil (assets/perfil.ini) com a seção [conta] e sem comentários.
- `aapt2 dump badging`: o pacote; versionName e versionCode da versão (version_code.py); minSdkVersion:'28' (o aapt
  antigo escrevia sdkVersion); targetSdkVersion:'36'; application-label:'Starsonic Phone'; a activity de entrada com
  label='Starsonic'; e as permissões (uses-permission) exatamente as de PERMISSIONS, nem uma a mais nem uma a menos
  (entre elas a de instalar apps, do atualizador, e a dos contatos da 0.2).
- `apksigner verify --print-certs`: a assinatura vale e tem um assinante só, com o certificado do SHA-256 de
  --cert-sha256 (build/android/signing-cert.sha256 na publicação).
- Com --release (o APK de publicação): sem application-debuggable, e o manifesto (`aapt2 dump xmltree`) sem
  networkSecurityConfig nem usesCleartextTraffic (o HTTP sem TLS é só do build de debug, Task 10).
- Com --nm: a libstarsonic.so de cada ABI só exporta o JNI (JNI_OnLoad e Java_br_com_starsonic_phone_*).
- Com --dexdump: o que o código nativo e o Android acham pelo nome está no dex com o nome de sempre (KEPT: o R8 do
  release não pode tirar nem renomear) e, com --nm também, cada native do app tem a função da ponte em cada ABI.

Uso: check_apk.py APK --version VERSAO --cert-sha256 ARQ --aapt2 BIN --apksigner BIN [--abis ABI...] [--release]
                  [--nm BIN] [--dexdump BIN]
  --abis  padrão: arm64-v8a armeabi-v7a x86_64 (também separadas por vírgula)
  --nm    o llvm-nm do NDK (lê as três ABIs); --dexdump, o das build-tools
Código 0 = tudo certo; 1 = algum problema (todos são listados); 2 = uso (argumentos, APK ou arquivo do certificado).
No GitHub Actions, cada problema também vira uma anotação, e o resumo do que passou, um aviso.
"""
import argparse
import os
import re
import struct
import subprocess
import sys
import tempfile
import zipfile

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))   # os módulos ao lado, também com python3 -I

import elf_align  # noqa: E402
import version_code  # noqa: E402

ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
ABIS_64 = ("arm64-v8a", "x86_64")
LIBRARIES = ("libstarsonic.so", "liboboe.so", "libc++_shared.so")
PAGE = 16384
PACKAGE = "br.com.starsonic.phone"
APP_LABEL = "Starsonic Phone"
LAUNCHER_LABEL = "Starsonic"
MIN_SDK = "28"
TARGET_SDK = "36"
# As permissões que o APK pede (uses-permission), todas: as do manifesto do app
# (android/app/src/main/AndroidManifest.xml) e a que o androidx.core acrescenta (a dos receptores registrados no código,
# que só o próprio app tem). A 0.2 só acrescenta a dos contatos (READ_CONTACTS, spec da 0.2, 11.2); uma permissão nova
# de uma biblioteca também aparece aqui.
PERMISSIONS = frozenset((
    "android.permission.INTERNET",
    "android.permission.ACCESS_NETWORK_STATE",
    "android.permission.RECORD_AUDIO",
    "android.permission.MODIFY_AUDIO_SETTINGS",
    "android.permission.POST_NOTIFICATIONS",
    "android.permission.FOREGROUND_SERVICE",
    "android.permission.FOREGROUND_SERVICE_SPECIAL_USE",
    "android.permission.FOREGROUND_SERVICE_PHONE_CALL",
    "android.permission.FOREGROUND_SERVICE_MICROPHONE",
    "android.permission.MANAGE_OWN_CALLS",
    "android.permission.USE_FULL_SCREEN_INTENT",
    "android.permission.RECEIVE_BOOT_COMPLETED",
    "android.permission.WAKE_LOCK",
    "android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS",
    "android.permission.VIBRATE",
    "android.permission.REQUEST_INSTALL_PACKAGES",   # o atualizador (spec 7.6.5)
    "android.permission.READ_CONTACTS",              # a aba Contatos e o nome nas ligações (0.2)
    "br.com.starsonic.phone.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION",   # do androidx.core
))
_PERMISSION_RE = re.compile(r"^uses-permission(?:-sdk-\d+)?: name='([^']*)'")
FORBIDDEN = "MicroSIP"
NEEDLES = (FORBIDDEN.encode("utf-8"), FORBIDDEN.encode("utf-16-le"))
PROFILE = "assets/perfil.ini"
APP_CLASSES = "Lbr/com/starsonic/"
ACC_NATIVE = 0x0100
JNI_EXPORT = re.compile(r"JNI_OnLoad|Java_br_com_starsonic_phone_[A-Za-z0-9_]+")

_SINK = "Lbr/com/starsonic/phone/engine/EngineSink;"
_AUDIO = "Lorg/pjsip/PjAudioDevInfo;"
_NATIVE = "Lbr/com/starsonic/phone/Native;"
_WORKER = "Lbr/com/starsonic/phone/update/UpdateWorker;"

# O que o código nativo e o Android acham pelo nome no dex: o R8 do release não pode tirar nem renomear
# (proguard-rules.pro, as regras que vêm com as bibliotecas e as que o AGP tira do manifesto).
# (classe, membro, descritor, padrão): membro None = só a classe; descritor None = qualquer um; o padrão (expressão
# regular), quando há, vale no lugar do descritor exato.
KEPT = (
    # O áudio Oboe do PJSIP (pjmedia/src/pjmedia-audiodev/oboe_dev.cpp): a classe, os métodos e os campos.
    (_AUDIO, "GetCount", "()I", None),
    (_AUDIO, "GetInfo", "(I)Lorg/pjsip/PjAudioDevInfo;", None),
    (_AUDIO, "RefreshDevices", "(Landroid/content/Context;)V", None),
    (_AUDIO, "id", "I", None),
    (_AUDIO, "name", "Ljava/lang/String;", None),
    (_AUDIO, "direction", "I", None),
    (_AUDIO, "supportedClockRates", "[I", None),
    (_AUDIO, "supportedChannelCounts", "[I", None),
    # A ponte JNI (jni_bridge.cpp, JniListener) entrega os avisos do motor por estes métodos (Task 6).
    (_SINK, "onRegistration", "(IZI)V", None),
    (_SINK, "onIncomingCall", "(ILjava/lang/String;Ljava/lang/String;)V", None),
    (_SINK, "onRejectedBusy", "(Ljava/lang/String;Ljava/lang/String;)V", None),
    (_SINK, "onCallState", "(III)V", None),
    (_SINK, "onTransfer", "(II)V", None),
    (_SINK, "onLog", "(ILjava/lang/String;)V", None),
    # O Android acha cada função da ponte pelo nome da classe e do método (Java_<classe>_<método>); as do atualizador
    # (Task 10) e uma de cada uma das outras classes com natives.
    (_NATIVE, "parseManifest", "(Ljava/lang/String;Ljava/lang/String;)[Ljava/lang/String;", None),
    (_NATIVE, "compareVersions", "(Ljava/lang/String;Ljava/lang/String;)I", None),
    ("Lbr/com/starsonic/phone/engine/NativeSipGateway;", "nativeStart", None, None),
    ("Lbr/com/starsonic/phone/core/LoginFlowHandle;", "nativeCreate", None, None),
    # O WorkManager cria o worker pelo nome guardado no banco dele, com o construtor (Context, WorkerParameters); o R8
    # pode renomear a WorkerParameters, que o WorkManager pede pela classe que ele mesmo usa.
    (_WORKER, "<init>", "(Landroid/content/Context;Landroidx/work/WorkerParameters;)V",
     r"\(Landroid/content/Context;L[^;]+;\)V"),
    # O receptor do instalador do Android vem do manifesto (Task 10).
    ("Lbr/com/starsonic/phone/update/UpdateStatusReceiver;", None, None, None),
)

_CLASS_RE = re.compile(r"Class descriptor\s*:\s*'(.+)'$")
_MEMBER_RE = re.compile(r"#\d+\s*:\s*\(in .+\)$")
_NAME_RE = re.compile(r"name\s*:\s*'(.*)'$")
_TYPE_RE = re.compile(r"type\s*:\s*'(.*)'$")
_ACCESS_RE = re.compile(r"access\s*:\s*0x([0-9a-fA-F]+)")
# "Signer #1 certificate SHA-256 digest: ..." (apksigner antigo) ou "V2 Signer: certificate SHA-256 digest: ..." (um
# por esquema de assinatura, nas build-tools 37).
_SIGNER_RE = re.compile(r"^(.*?)\s*:?\s*certificate SHA-256 digest: ([0-9a-fA-F:]+)\s*$", re.MULTILINE)


def _tail(text, lines=12, limit=1500):
    """O fim de uma saída numa linha só (para as mensagens)."""
    kept = [line.strip() for line in text.strip().splitlines() if line.strip()][-lines:]
    joined = " | ".join(kept)
    return joined if len(joined) <= limit else "..." + joined[-limit:]


def _short(descriptor):
    """Lbr/com/x/Classe; -> Classe."""
    return descriptor[1:-1].rsplit("/", 1)[-1]


# ---------------------------------------------------------------------------------------------------------------------
# O zip


def check_libraries(apk, abis):
    """As três bibliotecas de cada ABI pedida, e nenhuma pasta lib/ de outra ABI."""
    names = set(apk.namelist())
    errors = []
    for abi in abis:
        for library in LIBRARIES:
            path = "lib/%s/%s" % (abi, library)
            if path not in names:
                errors.append("o APK não traz %s" % path)
    found = sorted({name.split("/")[1] for name in names if name.startswith("lib/") and name.count("/") >= 2})
    for abi in found:
        if abi not in abis:
            errors.append("o APK traz bibliotecas de uma ABI que não foi pedida: lib/%s/" % abi)
    return errors


def _data_offset(raw, info):
    """Onde começam os dados da entrada no arquivo: depois do cabeçalho local (que tem o extra próprio)."""
    raw.seek(info.header_offset)
    header = raw.read(30)
    if len(header) < 30 or header[:4] != b"PK\x03\x04":
        raise ValueError("cabeçalho local inválido")
    name_length, extra_length = struct.unpack("<HH", header[26:30])
    return info.header_offset + 30 + name_length + extra_length


def check_alignment(apk):
    """16 KB nas .so das ABIs de 64 bits: os PT_LOAD do ELF e, sem compressão, o começo dos dados no zip."""
    errors = []
    with tempfile.TemporaryDirectory() as tmp, open(apk.filename, "rb") as raw:
        for info in apk.infolist():
            parts = info.filename.split("/")
            if len(parts) != 3 or parts[0] != "lib" or parts[1] not in ABIS_64 or not parts[2].endswith(".so"):
                continue
            path = os.path.join(tmp, "%s-%s" % (parts[1], parts[2]))
            with open(path, "wb") as out:
                out.write(apk.read(info))
            try:
                alignments = elf_align.load_alignments(path)
            except (ValueError, OSError) as error:
                errors.append("%s: não é uma biblioteca ELF que se possa ler (%s)"
                              % (info.filename, str(error).split(": ", 1)[-1]))
                continue
            if not alignments:
                errors.append("%s: sem segmentos PT_LOAD" % info.filename)
            elif min(alignments) < PAGE:
                errors.append("%s: PT_LOAD alinhados a %s (precisa de %d ou mais: celulares com páginas de 16 KB)"
                              % (info.filename, ", ".join(str(value) for value in alignments), PAGE))
            if info.compress_type == zipfile.ZIP_STORED:
                offset = _data_offset(raw, info)
                if offset % PAGE:
                    errors.append("%s: guardada sem compressão no byte %d do APK, fora de um múltiplo de 16 KB"
                                  % (info.filename, offset))
    return errors


def check_forbidden_text(apk):
    """Nenhum "MicroSIP" (exato) no nome nem no conteúdo dos arquivos, em UTF-8 ou UTF-16LE."""
    errors = []
    for info in apk.infolist():
        if info.is_dir():
            continue
        if FORBIDDEN in info.filename or any(needle in apk.read(info) for needle in NEEDLES):
            errors.append('o APK tem "%s" em %s' % (FORBIDDEN, info.filename))
    return errors


def check_profile(apk):
    """O perfil vai sem os comentários (como no Windows), com a seção [conta]."""
    try:
        text = apk.read(PROFILE).decode("utf-8")
    except KeyError:
        return ["o APK não traz %s" % PROFILE]
    except UnicodeDecodeError:
        return ["%s não está em UTF-8" % PROFILE]
    errors = []
    if "[conta]" not in [line.strip() for line in text.splitlines()]:
        errors.append("%s sem a seção [conta]" % PROFILE)
    if ";" in text:
        errors.append("%s com comentários (;), que ficam fora do APK" % PROFILE)
    return errors


# ---------------------------------------------------------------------------------------------------------------------
# As saídas das ferramentas


def check_badging(text, version, release):
    """O `aapt2 dump badging`: pacote, versão, SDKs, nomes, as permissões e, no release, sem debuggable."""
    lines = [line.rstrip() for line in text.splitlines()]
    package = next((line for line in lines if line.startswith("package:")), None)
    if package is None:
        return ["o aapt2 dump badging não tem a linha package: (%s)" % (_tail(text) or "saída vazia")]
    errors = []
    attributes = dict(re.findall(r"(\w+)='([^']*)'", package))
    expected = {"name": PACKAGE, "versionName": version, "versionCode": str(version_code.version_code(version))}
    for key, value in expected.items():
        if attributes.get(key) != value:
            errors.append("package: %s='%s' (esperado '%s')" % (key, attributes.get(key, ""), value))
    if not ("minSdkVersion:'%s'" % MIN_SDK in lines or "sdkVersion:'%s'" % MIN_SDK in lines):
        found = [line for line in lines if re.match(r"(min)?[sS]dkVersion:", line)]
        errors.append("o aapt2 dump badging não tem minSdkVersion:'%s' (tem: %s)" % (MIN_SDK, ", ".join(found) or "nada"))
    for wanted, prefix in (("targetSdkVersion:'%s'" % TARGET_SDK, "targetSdkVersion:"),
                           ("application-label:'%s'" % APP_LABEL, "application-label:")):
        if wanted not in lines:
            found = [line for line in lines if line.startswith(prefix)]
            errors.append("o aapt2 dump badging não tem %s (tem: %s)" % (wanted, ", ".join(found) or "nada"))
    launchers = [line for line in lines if line.startswith("launchable-activity:")]
    if len(launchers) != 1:
        errors.append("o aapt2 dump badging tem %d activities de entrada (launchable-activity); esperada uma"
                      % len(launchers))
    else:
        label = re.search(r"\blabel='([^']*)'", launchers[0])
        if label is None or label.group(1) != LAUNCHER_LABEL:
            errors.append("a activity de entrada tem label='%s' (esperado label='%s', o nome embaixo do ícone)"
                          % (label.group(1) if label else "", LAUNCHER_LABEL))
    requested = {match.group(1) for match in map(_PERMISSION_RE.match, lines) if match}
    missing = sorted(PERMISSIONS - requested)
    extra = sorted(requested - PERMISSIONS)
    if missing or extra:
        parts = (["falta(m) %s" % ", ".join(missing)] if missing else []) + \
                (["sobra(m) %s (permissão nova: só com a lista do check_apk.py)" % ", ".join(extra)] if extra else [])
        errors.append("as permissões do APK (uses-permission) não são as esperadas: %s" % "; ".join(parts))
    if release and "application-debuggable" in lines:
        errors.append("o APK de publicação está marcado como application-debuggable")
    return errors


def check_manifest(text):
    """O manifesto do APK de publicação (`aapt2 dump xmltree`), sem as liberações de HTTP sem TLS do debug."""
    if not re.search(r"E: manifest\b", text):
        return ["o aapt2 dump xmltree não mostrou o manifesto (%s)" % (_tail(text) or "saída vazia")]
    errors = []
    for attribute in ("networkSecurityConfig", "usesCleartextTraffic"):
        if re.search(r"\b%s\b" % attribute, text):
            errors.append("o manifesto do APK de publicação tem %s (o HTTP sem TLS é só do build de debug)" % attribute)
    return errors


def read_expected_sha256(path):
    """O SHA-256 esperado do certificado: 64 dígitos hexadecimais (aceita ':' e maiúsculas). ValueError se não for."""
    with open(path, encoding="ascii", errors="replace") as handle:
        value = re.sub(r"[\s:]", "", handle.read()).lower()
    if not re.fullmatch(r"[0-9a-f]{64}", value):
        raise ValueError("%s: esperado o SHA-256 do certificado (64 dígitos hexadecimais)" % path)
    return value


def check_certificate(text, expected):
    """O `apksigner verify --print-certs`: um certificado só (o mesmo em todos os esquemas), o esperado. O carimbo de
    origem (Source Stamp), quando há, não é quem assina o app."""
    digests = []
    for match in _SIGNER_RE.finditer(text):
        digest = re.sub(":", "", match.group(2)).lower()
        if "Source Stamp" not in match.group(1) and digest not in digests:
            digests.append(digest)
    if not digests:
        return ["o apksigner não mostrou o certificado do APK (%s)" % (_tail(text) or "saída vazia")]
    if len(digests) > 1:
        return ["o APK tem %d assinantes (%s); esperado um só, com o certificado %s"
                % (len(digests), ", ".join(digests), expected)]
    if digests[0] != expected:
        return ["o APK foi assinado com o certificado SHA-256 %s, e não com o esperado (%s)" % (digests[0], expected)]
    return []


def parse_nm(text):
    """Os nomes dos símbolos de `nm -D --defined-only` (a última coluna de cada linha)."""
    return [line.split()[-1] for line in text.splitlines() if line.strip()]


def check_exports(symbols, abi):
    """A libstarsonic.so só exporta o JNI; sem o JNI_OnLoad, a listagem não serve (o nm não viu nada)."""
    errors = []
    if "JNI_OnLoad" not in symbols:
        errors.append("a libstarsonic.so de %s não exporta o JNI_OnLoad (o nm listou %d símbolos)" % (abi, len(symbols)))
    other = [symbol for symbol in symbols if not JNI_EXPORT.fullmatch(symbol)]
    if other:
        errors.append("a libstarsonic.so de %s exporta mais que o JNI: %s" % (abi, " ".join(other[:20])))
    return errors


def parse_dexdump(lines):
    """As classes do `dexdump` (formato plain): {descritor: [(nome, tipo, acesso)]}, com campos e métodos.

    Cada membro começa por "#N : (in <classe>)" e traz name, type e access, nessa ordem."""
    classes = {}
    current = None
    member = None
    for line in lines:
        text = line.strip()
        match = _CLASS_RE.match(text)
        if match:
            current = classes.setdefault(match.group(1), [])
            member = None
        elif current is None:
            continue
        elif _MEMBER_RE.match(text):
            member = {}
        elif member is not None:
            name, kind, access = _NAME_RE.match(text), _TYPE_RE.match(text), _ACCESS_RE.match(text)
            if name:
                member["name"] = name.group(1)
            elif kind:
                member["type"] = kind.group(1)
            elif access and "name" in member and "type" in member:
                current.append((member["name"], member["type"], int(access.group(1), 16)))
                member = None
    return classes


def _mangle(text):
    """O nome no formato do JNI (Java_<classe>_<método>): '/' vira '_', e '_', ';', '[' e o resto viram escapes."""
    out = []
    for char in text:
        if char == "/":
            out.append("_")
        elif char == "_":
            out.append("_1")
        elif char == ";":
            out.append("_2")
        elif char == "[":
            out.append("_3")
        elif char.isascii() and char.isalnum():
            out.append(char)
        else:
            encoded = char.encode("utf-16-le")
            out.extend("_0%04x" % unit for unit in struct.unpack("<%dH" % (len(encoded) // 2), encoded))
    return "".join(out)


def jni_name(descriptor, method):
    """O nome curto da função JNI de um native: Java_br_com_x_Classe_metodo."""
    return "Java_%s_%s" % (_mangle(descriptor[1:-1]), _mangle(method))


def check_dex(classes, exports_by_abi):
    """KEPT no dex e, com as exportações da libstarsonic.so por ABI, a função da ponte de cada native do app."""
    if not classes:
        return ["o dexdump não listou nenhuma classe"]
    errors = []
    missing = []
    for descriptor, name, signature, pattern in KEPT:
        members = classes.get(descriptor)
        if members is None:
            if descriptor not in missing:
                missing.append(descriptor)
                errors.append("o dex não tem a classe %s (o R8 a tirou ou renomeou)" % descriptor)
            continue
        if name is None:
            continue
        if not any(found == name and (signature is None or
                                      (re.fullmatch(pattern, kind) if pattern else kind == signature))
                   for found, kind, _ in members):
            errors.append("o dex não tem %s.%s%s em %s (o R8 o tirou ou renomeou)"
                          % (_short(descriptor), name, " " + signature if signature else "", descriptor))
    if exports_by_abi:
        for descriptor, members in classes.items():
            if not descriptor.startswith(APP_CLASSES):
                continue
            for name, _, access in members:
                if not access & ACC_NATIVE:
                    continue
                function = jni_name(descriptor, name)
                absent = [abi for abi, symbols in exports_by_abi.items() if function not in symbols]
                if absent:
                    errors.append("o native %s.%s não tem a função %s na libstarsonic.so de %s"
                                  % (_short(descriptor), name, function, ", ".join(absent)))
    return errors


def describe_dex(classes, exports_by_abi):
    """O resumo do que o dex mostrou (para o log e a anotação)."""
    natives = sum(1 for descriptor, members in classes.items() if descriptor.startswith(APP_CLASSES)
                  for _, _, access in members if access & ACC_NATIVE)
    worker = next((kind for name, kind, _ in classes.get(_WORKER, []) if name == "<init>"), "?")
    text = "dex com as %d entradas que o R8 precisa manter (EngineSink, PjAudioDevInfo, Native, UpdateWorker.<init>%s, " \
           "UpdateStatusReceiver)" % (len(KEPT), worker)
    if exports_by_abi:
        text += "; %d natives do app com a função da ponte em %s" % (natives, ", ".join(exports_by_abi))
    return text


# ---------------------------------------------------------------------------------------------------------------------
# A linha de comando


def _run(problems, label, command):
    """A saída do comando; com erro (ou sem o programa), o problema vai para a lista e volta None."""
    try:
        result = subprocess.run(command, capture_output=True, text=True, errors="replace")
    except OSError as error:
        problems.append("%s não rodou (%s): %s" % (label, command[0], error))
        return None
    if result.returncode != 0:
        problems.append("%s saiu com o código %d: %s"
                        % (label, result.returncode, _tail(result.stdout + "\n" + result.stderr) or "sem saída"))
        return None
    return result.stdout


def _run_dexdump(problems, dexdump, files):
    """As classes de todos os dex, lidas enquanto o dexdump escreve (a saída é grande)."""
    with tempfile.TemporaryFile("w+", encoding="utf-8", errors="replace") as err:
        try:
            process = subprocess.Popen([dexdump] + files, stdout=subprocess.PIPE, stderr=err, text=True,
                                       errors="replace")
        except OSError as error:
            problems.append("dexdump não rodou (%s): %s" % (dexdump, error))
            return None
        with process.stdout:
            classes = parse_dexdump(process.stdout)
        if process.wait() != 0:
            err.seek(0)
            problems.append("dexdump saiu com o código %d: %s" % (process.returncode, _tail(err.read()) or "sem saída"))
            return None
    return classes


def _extract(apk, name, folder):
    path = os.path.join(folder, *name.split("/"))
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as out:
        out.write(apk.read(name))
    return path


def _annotation(kind, text):
    text = text.replace("%", "%25").replace("\r", "%0D").replace("\n", "%0A")
    return "::%s title=check_apk::%s" % (kind, text)


def _check(apk, args, abis, expected, notes):
    problems = []
    problems += check_libraries(apk, abis)
    problems += check_alignment(apk)
    problems += check_forbidden_text(apk)
    problems += check_profile(apk)
    badging = _run(problems, "aapt2 dump badging", [args.aapt2, "dump", "badging", args.apk])
    if badging is not None:
        problems += check_badging(badging, args.version, args.release)
    if args.release:
        tree = _run(problems, "aapt2 dump xmltree",
                    [args.aapt2, "dump", "xmltree", "--file", "AndroidManifest.xml", args.apk])
        if tree is not None:
            problems += check_manifest(tree)
    signers = _run(problems, "apksigner verify", [args.apksigner, "verify", "--print-certs", args.apk])
    if signers is not None:
        problems += check_certificate(signers, expected)
    names = apk.namelist()
    with tempfile.TemporaryDirectory() as tmp:
        exports = None
        if args.nm:
            exports = {}
            for abi in abis:
                name = "lib/%s/libstarsonic.so" % abi
                if name not in names:
                    continue   # check_libraries já reclamou
                output = _run(problems, "nm (%s)" % abi, [args.nm, "-D", "--defined-only", _extract(apk, name, tmp)])
                if output is not None:
                    symbols = parse_nm(output)
                    problems += check_exports(symbols, abi)
                    exports[abi] = symbols
            notes.append("a libstarsonic.so só exporta o JNI em %s" % ", ".join(exports))
        if args.dexdump:
            dex = [_extract(apk, name, tmp) for name in sorted(names) if re.fullmatch(r"classes\d*\.dex", name)]
            if not dex:
                problems.append("o APK não traz classes.dex")
            else:
                classes = _run_dexdump(problems, args.dexdump, dex)
                if classes is not None:
                    problems += check_dex(classes, exports)
                    notes.append(describe_dex(classes, exports))
    return problems


def main(argv):
    parser = argparse.ArgumentParser(description="Confere o APK do Starsonic Phone antes de publicar.")
    parser.add_argument("apk")
    parser.add_argument("--version", required=True, help="X.Y.Z ou X.Y.Z-rc.N (versionName; o versionCode sai dela)")
    parser.add_argument("--cert-sha256", required=True, help="arquivo com o SHA-256 do certificado esperado")
    parser.add_argument("--aapt2", required=True)
    parser.add_argument("--apksigner", required=True)
    parser.add_argument("--abis", nargs="+", default=list(ABIS))
    parser.add_argument("--release", action="store_true", help="o APK de publicação (sem debuggable e sem HTTP)")
    parser.add_argument("--nm", help="llvm-nm (os símbolos exportados da libstarsonic.so)")
    parser.add_argument("--dexdump", help="dexdump (o que o R8 precisa manter no dex)")
    args = parser.parse_args(argv)
    abis = [abi for value in args.abis for abi in value.split(",") if abi]
    try:
        code = version_code.version_code(args.version)
        expected = read_expected_sha256(args.cert_sha256)
        apk = zipfile.ZipFile(args.apk)
    except (ValueError, OSError, zipfile.BadZipFile) as error:
        print("check_apk: %s" % error, file=sys.stderr)
        return 2
    notes = []
    with apk:
        problems = _check(apk, args, abis, expected, notes)
        libraries = sum(1 for name in apk.namelist() if name.startswith("lib/") and name.endswith(".so"))
    actions = os.environ.get("GITHUB_ACTIONS") == "true"
    if problems:
        for problem in problems:
            print("check_apk: %s" % problem, file=sys.stderr)
            if actions:
                print(_annotation("error", problem))
        print("check_apk: %d problema(s) em %s" % (len(problems), args.apk), file=sys.stderr)
        return 1
    summary = ("%s: %s %s (versionCode %d), ABIs %s, %d bibliotecas .so (16 KB nas de 64 bits), sem %s, "
               "certificado SHA-256 %s" % (os.path.basename(args.apk), PACKAGE, args.version, code, ", ".join(abis),
                                           libraries, FORBIDDEN, expected))
    if args.release:
        summary += ", sem debuggable e sem HTTP sem TLS no manifesto"
    summary = "; ".join([summary] + notes)
    print("ok: " + summary)
    if actions:
        print(_annotation("notice", summary))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
