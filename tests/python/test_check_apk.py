"""build/android/check_apk.py: a conferência do APK antes de publicar (spec 11.2), com APKs sintéticos (zip) e saídas
de exemplo do aapt2, do apksigner, do nm e do dexdump (texto), certas e erradas.
"""
import contextlib
import io
import os
import pathlib
import struct
import sys
import tempfile
import textwrap
import unittest
import zipfile
from unittest import mock

ROOT = pathlib.Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "build" / "android"))

import check_apk  # noqa: E402

KB4, KB16 = 0x1000, 0x4000
ABIS = ("arm64-v8a", "armeabi-v7a", "x86_64")
VERSION = "0.1.0-rc.1"
CERT = "3a" * 32
OTHER_CERT = "c4" * 32


def elf(align, bits=64):
    """ELF sintético com um segmento PT_LOAD de alinhamento align (só o cabeçalho e a tabela de programas)."""
    ident = b"\x7fELF" + bytes([2 if bits == 64 else 1, 1, 1]) + bytes(9)
    if bits == 64:
        header = struct.pack("<HHIQQQIHHHHHH", 3, 183, 1, 0, 64, 0, 0, 64, 56, 1, 0, 0, 0)
        table = struct.pack("<IIQQQQQQ", 1, 5, 0, 0, 0, 0, 0, align)
    else:
        header = struct.pack("<HHIIIIIHHHHHH", 3, 40, 1, 0, 52, 0, 0, 52, 32, 1, 0, 0, 0)
        table = struct.pack("<IIIIIIII", 1, 0, 0, 0, 0, 0, 5, align)
    return ident + header + table


def apk_files(abis=ABIS):
    """O conteúdo de um APK que passa: as quatro bibliotecas de cada ABI (a libc++_shared.so do armeabi-v7a com 4 KB,
    como vem do NDK), o manifesto, o dex, os recursos e o perfil sem comentários."""
    files = {}
    for abi in abis:
        bits = 32 if abi == "armeabi-v7a" else 64
        for lib in ("libstarsonic.so", "liboboe.so", "libc++_shared.so", "libandroidx.graphics.path.so"):
            align = KB4 if (abi, lib) == ("armeabi-v7a", "libc++_shared.so") else KB16
            files["lib/%s/%s" % (abi, lib)] = elf(align, bits)
    files["AndroidManifest.xml"] = b"\x03\x00\x08\x00manifesto binario"
    files["classes.dex"] = b"dex\n039\x00" + b"Lbr/com/starsonic/phone/App;" + "CodecsToMicrosip".encode("ascii")
    files["resources.arsc"] = "Starsonic Phone".encode("utf-16-le")
    files["assets/perfil.ini"] = b"[conta]\nporta=5060\nprotocolo=udp\n"
    return files


def write_apk(path, files, zip_align=KB16, off_by_4k=()):
    """Grava o zip. As .so vão sem compressão e, com zip_align, começam num múltiplo dele (como o AGP faz), por um campo
    extra de preenchimento no cabeçalho local; as de off_by_4k ficam 4 KB depois de um múltiplo de 16 KB."""
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as apk:
        for name, data in files.items():
            info = zipfile.ZipInfo(name, date_time=(2026, 10, 15, 12, 0, 0))
            info.compress_type = zipfile.ZIP_DEFLATED
            if name.endswith(".so"):
                info.compress_type = zipfile.ZIP_STORED
                if zip_align:
                    start = apk.fp.tell() + 30 + len(name.encode("utf-8")) + 4
                    pad = (-start) % zip_align
                    if name in off_by_4k:
                        pad += KB4
                    info.extra = struct.pack("<HH", 0xD935, pad) + bytes(pad)
            apk.writestr(info, data)
    return path


BADGING = textwrap.dedent("""\
    package: name='br.com.starsonic.phone' versionCode='10001' versionName='0.1.0-rc.1' platformBuildVersionName='17' platformBuildVersionCode='37' compileSdkVersion='37' compileSdkVersionCodename='17'
    minSdkVersion:'28'
    targetSdkVersion:'36'
    uses-permission: name='android.permission.INTERNET'
    uses-permission: name='android.permission.ACCESS_NETWORK_STATE'
    uses-permission: name='android.permission.RECORD_AUDIO'
    uses-permission: name='android.permission.MODIFY_AUDIO_SETTINGS'
    uses-permission: name='android.permission.POST_NOTIFICATIONS'
    uses-permission: name='android.permission.FOREGROUND_SERVICE'
    uses-permission: name='android.permission.FOREGROUND_SERVICE_SPECIAL_USE'
    uses-permission: name='android.permission.FOREGROUND_SERVICE_PHONE_CALL'
    uses-permission: name='android.permission.FOREGROUND_SERVICE_MICROPHONE'
    uses-permission: name='android.permission.MANAGE_OWN_CALLS'
    uses-permission: name='android.permission.USE_FULL_SCREEN_INTENT'
    uses-permission: name='android.permission.RECEIVE_BOOT_COMPLETED'
    uses-permission: name='android.permission.WAKE_LOCK'
    uses-permission: name='android.permission.REQUEST_IGNORE_BATTERY_OPTIMIZATIONS'
    uses-permission: name='android.permission.VIBRATE'
    uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'
    uses-permission: name='android.permission.READ_CONTACTS'
    uses-permission: name='br.com.starsonic.phone.DYNAMIC_RECEIVER_NOT_EXPORTED_PERMISSION'
    application-label:'Starsonic Phone'
    application-icon-160:'res/mipmap-anydpi-v26/ic_launcher.xml'
    application: label='Starsonic Phone' icon='res/mipmap-anydpi-v26/ic_launcher.xml'
    launchable-activity: name='br.com.starsonic.phone.main.MainActivity'  label='Starsonic' icon=''
    feature-group: label=''
      uses-feature: name='android.hardware.microphone'
    main
    other-activities
    other-receivers
    other-services
    supports-screens: 'small' 'normal' 'large' 'xlarge'
    supports-any-density: 'true'
    locales: '--_--' 'pt-BR'
    densities: '160' '240' '320' '480' '640' '65534'
    native-code: 'arm64-v8a' 'armeabi-v7a' 'x86_64'
    """)
DEBUGGABLE = BADGING.replace("main\n", "application-debuggable\nmain\n")

XMLTREE = textwrap.dedent("""\
    N: android=http://schemas.android.com/apk/res/android (line=2)
      E: manifest (line=2)
        A: http://schemas.android.com/apk/res/android:versionCode(0x0101021b)=10001
        A: http://schemas.android.com/apk/res/android:versionName(0x0101021c)="0.1.0-rc.1" (Raw: "0.1.0-rc.1")
        A: package="br.com.starsonic.phone" (Raw: "br.com.starsonic.phone")
        E: application (line=40)
          A: http://schemas.android.com/apk/res/android:label(0x01010001)=@0x7f120001
          A: http://schemas.android.com/apk/res/android:allowBackup(0x01010280)=false
          A: http://schemas.android.com/apk/res/android:dataExtractionRules(0x0101063e)=@0x7f150000
          E: receiver (line=120)
            A: http://schemas.android.com/apk/res/android:name(0x01010003)="br.com.starsonic.phone.update.UpdateStatusReceiver" (Raw: "br.com.starsonic.phone.update.UpdateStatusReceiver")
            A: http://schemas.android.com/apk/res/android:exported(0x01010010)=false
    """)
NETWORK_SECURITY_CONFIG = ("      A: http://schemas.android.com/apk/res/android:networkSecurityConfig(0x01010527)"
                           "=@0x7f150001\n")
CLEARTEXT = "      A: http://schemas.android.com/apk/res/android:usesCleartextTraffic(0x010104ec)=(type 0x12)0xffffffff\n"


def certs(*sha256s):
    """A saída do `apksigner verify --print-certs`, com um assinante por SHA-256."""
    lines = []
    for number, sha in enumerate(sha256s, 1):
        lines += ["Signer #%d certificate DN: CN=Starsonic Phone, O=Starsonic, L=Sao Paulo, ST=SP, C=BR" % number,
                  "Signer #%d certificate SHA-256 digest: %s" % (number, sha),
                  "Signer #%d certificate SHA-1 digest: %s" % (number, "5b" * 20),
                  "Signer #%d certificate MD5 digest: %s" % (number, "7e" * 16)]
    return "\n".join(lines) + "\n"


EXPORTS = ("JNI_OnLoad", "Java_br_com_starsonic_phone_Native_parseManifest",
           "Java_br_com_starsonic_phone_Native_compareVersions",
           "Java_br_com_starsonic_phone_engine_NativeSipGateway_nativeStart",
           "Java_br_com_starsonic_phone_core_LoginFlowHandle_nativeCreate",
           # Uma função da ponte cujo native o R8 tirou do dex por não ser usado: não faz mal.
           "Java_br_com_starsonic_phone_Native_validateRamal")


def nm_output(names=EXPORTS):
    """A saída do `llvm-nm -D --defined-only` da libstarsonic.so."""
    return "".join("%016x T %s\n" % (0x45a10 + 0x40 * index, name) for index, name in enumerate(names))


# Acesso dos membros no dex.
PUBLIC, PRIVATE, STATIC, FINAL, NATIVE, CONSTRUCTOR = 0x1, 0x2, 0x8, 0x10, 0x100, 0x10000
SECTIONS = ("Static fields", "Instance fields", "Direct methods", "Virtual methods")
SINK = "Lbr/com/starsonic/phone/engine/EngineSink;"
WORKER = "Lbr/com/starsonic/phone/update/UpdateWorker;"
WORKER_INIT = "(Landroid/content/Context;Landroidx/work/WorkerParameters;)V"


def dex_classes():
    """As classes de um dex de release (o R8 renomeia o resto, como La/b;), por descritor: [(seção, nome, tipo, acesso)]."""
    return {
        "Lorg/pjsip/PjAudioDevInfo;": [
            ("Static fields", "a", "Landroid/util/SparseArray;", PRIVATE | STATIC),
            ("Instance fields", "id", "I", PUBLIC),
            ("Instance fields", "name", "Ljava/lang/String;", PUBLIC),
            ("Instance fields", "direction", "I", PUBLIC),
            ("Instance fields", "supportedClockRates", "[I", PUBLIC),
            ("Instance fields", "supportedChannelCounts", "[I", PUBLIC),
            ("Direct methods", "GetCount", "()I", PUBLIC | STATIC),
            ("Direct methods", "GetInfo", "(I)Lorg/pjsip/PjAudioDevInfo;", PUBLIC | STATIC),
            ("Direct methods", "RefreshDevices", "(Landroid/content/Context;)V", PUBLIC | STATIC),
        ],
        SINK: [
            ("Instance fields", "a", "Lbr/com/starsonic/phone/engine/EngineEvents;", PRIVATE | FINAL),
            ("Virtual methods", "onRegistration", "(IZI)V", PUBLIC | FINAL),
            ("Virtual methods", "onIncomingCall", "(ILjava/lang/String;Ljava/lang/String;)V", PUBLIC | FINAL),
            ("Virtual methods", "onRejectedBusy", "(Ljava/lang/String;Ljava/lang/String;)V", PUBLIC | FINAL),
            ("Virtual methods", "onCallState", "(III)V", PUBLIC | FINAL),
            ("Virtual methods", "onTransfer", "(II)V", PUBLIC | FINAL),
            ("Virtual methods", "onLog", "(ILjava/lang/String;)V", PUBLIC | FINAL),
        ],
        WORKER: [("Direct methods", "<init>", WORKER_INIT, PUBLIC | CONSTRUCTOR)],
        "Lbr/com/starsonic/phone/update/UpdateStatusReceiver;": [
            ("Direct methods", "<init>", "()V", PUBLIC | CONSTRUCTOR),
        ],
        "Lbr/com/starsonic/phone/Native;": [
            ("Virtual methods", "parseManifest", "(Ljava/lang/String;Ljava/lang/String;)[Ljava/lang/String;",
             PUBLIC | FINAL | NATIVE),
            ("Virtual methods", "compareVersions", "(Ljava/lang/String;Ljava/lang/String;)I", PUBLIC | FINAL | NATIVE),
        ],
        "Lbr/com/starsonic/phone/engine/NativeSipGateway;": [
            ("Direct methods", "nativeStart", "(Ljava/lang/String;Ljava/lang/String;%s)J" % SINK,
             PRIVATE | FINAL | NATIVE),
        ],
        "Lbr/com/starsonic/phone/core/LoginFlowHandle;": [
            ("Direct methods", "nativeCreate", "()J", PRIVATE | FINAL | NATIVE),
        ],
        # Um native de outra biblioteca (o graphics-path do Compose): não é da libstarsonic.so.
        "Landroidx/graphics/path/PathIteratorPreApi34Impl;": [
            ("Direct methods", "createInternalPathIterator", "(Landroid/graphics/Path;IF)J", PRIVATE | STATIC | NATIVE),
        ],
        "La/b;": [("Direct methods", "c", "()V", PUBLIC | STATIC)],
    }


def dexdump(classes):
    """O texto do `dexdump` (formato plain) das classes."""
    lines = ["Processing 'classes.dex'...", "Opened 'classes.dex', DEX version '039'"]
    for index, (descriptor, members) in enumerate(classes.items()):
        lines += ["Class #%d            -" % index,
                  "  Class descriptor  : '%s'" % descriptor,
                  "  Access flags      : 0x0011 (PUBLIC FINAL)",
                  "  Superclass        : 'Ljava/lang/Object;'",
                  "  Interfaces        -",
                  "    #0              : 'Ljava/lang/Runnable;'"]
        for section in SECTIONS:
            lines.append("  %-18s-" % section)
            chosen = [member for member in members if member[0] == section]
            for number, (_, name, kind, flags) in enumerate(chosen):
                lines += ["    #%-14d: (in %s)" % (number, descriptor),
                          "      name          : '%s'" % name,
                          "      type          : '%s'" % kind,
                          "      access        : 0x%04x (FLAGS)" % flags]
                if section.endswith("methods"):
                    lines.append("      code          : (none)" if flags & NATIVE else "      code          -")
        lines += ["  source_file_idx   : 0 (SourceFile)", ""]
    return "\n".join(lines) + "\n"


class ZipChecksTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)

    def tearDown(self):
        self.tmp.cleanup()

    def open_apk(self, files, **options):
        path = write_apk(self.dir / "app.apk", files, **options)
        apk = zipfile.ZipFile(path)
        self.addCleanup(apk.close)
        return apk

    def test_a_complete_apk_passes(self):
        apk = self.open_apk(apk_files())
        self.assertEqual(check_apk.check_libraries(apk, ABIS), [])
        self.assertEqual(check_apk.check_alignment(apk), [])
        self.assertEqual(check_apk.check_forbidden_text(apk), [])
        self.assertEqual(check_apk.check_profile(apk), [])

    def test_missing_libstarsonic_in_one_abi_fails(self):
        files = apk_files()
        del files["lib/armeabi-v7a/libstarsonic.so"]
        errors = check_apk.check_libraries(self.open_apk(files), ABIS)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("lib/armeabi-v7a/libstarsonic.so", errors[0])

    def test_missing_oboe_or_the_shared_stl_fails(self):
        for lib in ("liboboe.so", "libc++_shared.so"):
            with self.subTest(lib=lib):
                files = apk_files()
                del files["lib/x86_64/" + lib]
                errors = check_apk.check_libraries(self.open_apk(files), ABIS)
                self.assertTrue(any("lib/x86_64/" + lib in error for error in errors), errors)

    def test_only_the_abis_asked_for_are_checked_and_no_other_may_come(self):
        apk = self.open_apk(apk_files(("x86_64",)))
        self.assertEqual(check_apk.check_libraries(apk, ("x86_64",)), [])
        errors = check_apk.check_libraries(apk, ABIS)
        self.assertTrue(any("lib/arm64-v8a/libstarsonic.so" in error for error in errors), errors)
        files = apk_files()
        files["lib/x86/libstarsonic.so"] = elf(KB16, 32)
        errors = check_apk.check_libraries(self.open_apk(files), ABIS)
        self.assertTrue(any("x86" in error and "x86_64" not in error for error in errors), errors)

    def test_a_4k_load_segment_fails_on_the_64_bit_abis(self):
        for abi in ("arm64-v8a", "x86_64"):
            with self.subTest(abi=abi):
                files = apk_files()
                files["lib/%s/liboboe.so" % abi] = elf(KB4)
                errors = check_apk.check_alignment(self.open_apk(files))
                self.assertEqual(len(errors), 1, errors)
                self.assertIn("lib/%s/liboboe.so" % abi, errors[0])
                self.assertIn("4096", errors[0])

    def test_every_library_of_a_64_bit_abi_is_checked(self):
        files = apk_files()
        files["lib/arm64-v8a/libandroidx.graphics.path.so"] = elf(KB4)
        errors = check_apk.check_alignment(self.open_apk(files))
        self.assertTrue(any("libandroidx.graphics.path.so" in error for error in errors), errors)

    def test_4k_on_armeabi_v7a_is_accepted(self):
        # Ruling da Task 5: celular de 32 bits usa páginas de 4 KB (a libc++_shared.so do NDK vem assim).
        files = apk_files()
        files["lib/armeabi-v7a/libstarsonic.so"] = elf(KB4, 32)
        self.assertEqual(check_apk.check_alignment(self.open_apk(files)), [])

    def test_a_library_that_is_not_elf_fails(self):
        files = apk_files()
        files["lib/x86_64/libstarsonic.so"] = b"nao sou um ELF"
        errors = check_apk.check_alignment(self.open_apk(files))
        self.assertTrue(any("lib/x86_64/libstarsonic.so" in error for error in errors), errors)

    def test_a_stored_library_off_the_16k_boundary_of_the_zip_fails(self):
        apk = self.open_apk(apk_files(), off_by_4k=("lib/arm64-v8a/libstarsonic.so",))
        errors = check_apk.check_alignment(apk)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("lib/arm64-v8a/libstarsonic.so", errors[0])
        # Sem o alinhamento no zip, as de 64 bits não começam num múltiplo de 16 KB.
        errors = check_apk.check_alignment(self.open_apk(apk_files(), zip_align=None))
        self.assertTrue(errors)

    def test_microsip_in_any_file_fails(self):
        cases = {
            "assets/notas.txt": "Baseado no MicroSIP".encode("utf-8"),
            "classes.dex": b"dex\n039\x00LMicroSIP;",
            "resources.arsc": "Sobre o MicroSIP".encode("utf-16-le"),
            "lib/x86_64/libstarsonic.so": elf(KB16) + b"MicroSIP\x00",
            "res/raw/MicroSIP.txt": b"nada",
        }
        for name, data in cases.items():
            with self.subTest(name=name):
                files = apk_files()
                files[name] = data
                errors = check_apk.check_forbidden_text(self.open_apk(files))
                self.assertEqual(len(errors), 1, errors)
                self.assertIn(name, errors[0])
                self.assertIn("MicroSIP", errors[0])

    def test_other_spellings_pass(self):
        files = apk_files()
        files["assets/x.txt"] = b"CodecsToMicrosip microsip MICROSIP"
        self.assertEqual(check_apk.check_forbidden_text(self.open_apk(files)), [])

    def test_profile_with_the_account_section_and_without_comments(self):
        for text, wrong in ((b"[conta]\nporta=5060 ; a porta do MicroSIP\n", "coment"),
                            (b"[outra]\nporta=5060\n", "[conta]")):
            with self.subTest(wrong=wrong):
                files = apk_files()
                files["assets/perfil.ini"] = text
                errors = check_apk.check_profile(self.open_apk(files))
                self.assertEqual(len(errors), 1, errors)
                self.assertIn(wrong, errors[0])
        files = apk_files()
        del files["assets/perfil.ini"]
        self.assertTrue(check_apk.check_profile(self.open_apk(files)))


class BadgingTest(unittest.TestCase):
    def test_the_expected_badging_passes(self):
        self.assertEqual(check_apk.check_badging(BADGING, VERSION, release=True), [])
        self.assertEqual(check_apk.check_badging(DEBUGGABLE, VERSION, release=False), [])

    def test_the_old_sdk_version_line_of_aapt_is_accepted(self):
        old = BADGING.replace("minSdkVersion:'28'", "sdkVersion:'28'")
        self.assertEqual(check_apk.check_badging(old, VERSION, release=True), [])

    def test_wrong_values_fail(self):
        cases = {
            "application-label": BADGING.replace("application-label:'Starsonic Phone'", "application-label:'Starsonic'"),
            "label='Starsonic'": BADGING.replace("label='Starsonic' icon=''", "label='Starsonic Phone' icon=''"),
            "targetSdkVersion": BADGING.replace("targetSdkVersion:'36'", "targetSdkVersion:'35'"),
            "minSdkVersion": BADGING.replace("minSdkVersion:'28'", "minSdkVersion:'26'"),
            "br.com.starsonic.phone": BADGING.replace("name='br.com.starsonic.phone'", "name='br.com.starsonic.fone'"),
            "versionName": BADGING.replace("versionName='0.1.0-rc.1'", "versionName='0.1.0-rc.2'"),
            "versionCode": BADGING.replace("versionCode='10001'", "versionCode='1'"),
            "REQUEST_INSTALL_PACKAGES": BADGING.replace(
                "uses-permission: name='android.permission.REQUEST_INSTALL_PACKAGES'\n", ""),
        }
        for expected, text in cases.items():
            with self.subTest(expected=expected):
                errors = check_apk.check_badging(text, VERSION, release=True)
                self.assertEqual(len(errors), 1, errors)
                self.assertIn(expected, errors[0])

    def test_the_permissions_are_exactly_the_expected_ones(self):
        without_contacts = BADGING.replace("uses-permission: name='android.permission.READ_CONTACTS'\n", "")
        errors = check_apk.check_badging(without_contacts, VERSION, release=True)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("falta(m) android.permission.READ_CONTACTS", errors[0])
        extra = BADGING.replace("application-label:", "uses-permission: name='android.permission.READ_CALL_LOG'\n"
                                "uses-permission-sdk-23: name='android.permission.CAMERA'\napplication-label:")
        errors = check_apk.check_badging(extra, VERSION, release=True)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("sobra(m) android.permission.CAMERA, android.permission.READ_CALL_LOG", errors[0])
        both = without_contacts.replace("application-label:", "uses-permission: name='android.permission.CAMERA'\n"
                                        "application-label:")
        errors = check_apk.check_badging(both, VERSION, release=True)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("falta(m) android.permission.READ_CONTACTS; sobra(m) android.permission.CAMERA", errors[0])

    def test_permission_attributes_and_implied_permissions(self):
        # O maxSdkVersion não muda o nome, e as permissões que o aapt deduz (uses-implied-permission) não são pedidas.
        text = BADGING.replace("name='android.permission.VIBRATE'",
                               "name='android.permission.VIBRATE' maxSdkVersion='40'")
        text = text.replace("application-label:", "uses-implied-permission: name='android.permission.READ_CALL_LOG' "
                            "reason='targetSdkVersion < 16 and requested READ_CONTACTS'\napplication-label:")
        self.assertEqual(check_apk.check_badging(text, VERSION, release=True), [])

    def test_the_launcher_activity_must_be_there(self):
        text = "".join(line for line in BADGING.splitlines(True) if not line.startswith("launchable-activity"))
        errors = check_apk.check_badging(text, VERSION, release=True)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("launchable-activity", errors[0])

    def test_the_version_code_comes_from_the_version(self):
        final = BADGING.replace("versionCode='10001'", "versionCode='10099'").replace("0.1.0-rc.1", "0.1.0")
        self.assertEqual(check_apk.check_badging(final, "0.1.0", release=True), [])
        self.assertTrue(check_apk.check_badging(BADGING, "0.1.0", release=True))

    def test_a_debuggable_apk_is_not_a_release(self):
        errors = check_apk.check_badging(DEBUGGABLE, VERSION, release=True)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("debuggable", errors[0])

    def test_empty_output_fails(self):
        self.assertTrue(check_apk.check_badging("", VERSION, release=False))


class ManifestTest(unittest.TestCase):
    def test_the_release_manifest_has_no_cleartext_settings(self):
        self.assertEqual(check_apk.check_manifest(XMLTREE), [])

    def test_network_security_config_or_cleartext_traffic_fail(self):
        for name, line in (("networkSecurityConfig", NETWORK_SECURITY_CONFIG), ("usesCleartextTraffic", CLEARTEXT)):
            with self.subTest(name=name):
                errors = check_apk.check_manifest(XMLTREE + line)
                self.assertEqual(len(errors), 1, errors)
                self.assertIn(name, errors[0])

    def test_an_empty_tree_fails(self):
        self.assertTrue(check_apk.check_manifest(""))


class CertificateTest(unittest.TestCase):
    def test_the_expected_certificate_passes(self):
        self.assertEqual(check_apk.check_certificate(certs(CERT), CERT), [])

    def test_another_certificate_fails(self):
        errors = check_apk.check_certificate(certs(OTHER_CERT), CERT)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn(OTHER_CERT, errors[0])
        self.assertIn(CERT, errors[0])

    def test_two_signers_or_none_fail(self):
        self.assertTrue(check_apk.check_certificate(certs(CERT, OTHER_CERT), CERT))
        self.assertTrue(check_apk.check_certificate("", CERT))
        self.assertTrue(check_apk.check_certificate("DOES NOT VERIFY\nERROR: Missing META-INF/MANIFEST.MF\n", CERT))

    def test_the_signers_of_each_scheme_of_newer_apksigners(self):
        # O apksigner das build-tools 37 escreve o assinante de cada esquema ("V2 Signer: ..."); o mesmo certificado
        # em dois esquemas é um assinante só. O carimbo de origem (Source Stamp) não é quem assina o app.
        def scheme(name, sha):
            return ("%s: certificate DN: CN=Starsonic Phone, O=Starsonic, L=Sao Paulo, ST=SP, C=BR\n"
                    "%s: certificate SHA-256 digest: %s\n%s: certificate SHA-1 digest: %s\n"
                    % (name, name, sha, name, "5b" * 20))
        self.assertEqual(check_apk.check_certificate(scheme("V2 Signer", CERT), CERT), [])
        self.assertEqual(check_apk.check_certificate(scheme("V2 Signer", CERT) + scheme("V3 Signer", CERT), CERT), [])
        self.assertEqual(check_apk.check_certificate(scheme("V2 Signer", CERT) +
                                                     scheme("Source Stamp Signer", OTHER_CERT), CERT), [])
        errors = check_apk.check_certificate(scheme("V2 Signer", OTHER_CERT), CERT)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn(OTHER_CERT, errors[0])
        self.assertTrue(check_apk.check_certificate(scheme("V2 Signer", CERT) + scheme("V3 Signer", OTHER_CERT), CERT))

    def test_the_expected_file_may_have_colons_and_capitals(self):
        with tempfile.TemporaryDirectory() as tmp:
            path = pathlib.Path(tmp) / "cert.sha256"
            path.write_text(":".join(CERT.upper()[i:i + 2] for i in range(0, 64, 2)) + "\n", encoding="ascii")
            self.assertEqual(check_apk.read_expected_sha256(path), CERT)
            for wrong in ("", "3a" * 31, "zz" * 32, CERT + "\n" + OTHER_CERT):
                path.write_text(wrong, encoding="ascii")
                with self.assertRaises(ValueError, msg=wrong):
                    check_apk.read_expected_sha256(path)


class ExportsTest(unittest.TestCase):
    def test_only_the_jni_is_exported(self):
        symbols = check_apk.parse_nm(nm_output())
        self.assertEqual(symbols, list(EXPORTS))
        self.assertEqual(check_apk.check_exports(symbols, "x86_64"), [])

    def test_another_export_fails(self):
        symbols = check_apk.parse_nm(nm_output(EXPORTS + ("_ZN9starsonic9SipEngine6CreateEv",)))
        errors = check_apk.check_exports(symbols, "arm64-v8a")
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("_ZN9starsonic9SipEngine6CreateEv", errors[0])
        self.assertIn("arm64-v8a", errors[0])

    def test_without_jni_onload_fails(self):
        # Também pega uma listagem vazia, que faria a conferência passar sem ver nada.
        self.assertTrue(check_apk.check_exports([], "x86_64"))
        self.assertTrue(check_apk.check_exports(check_apk.parse_nm(nm_output(EXPORTS[1:])), "x86_64"))


class DexTest(unittest.TestCase):
    def parse(self, classes):
        return check_apk.parse_dexdump(io.StringIO(dexdump(classes)))

    def exports(self, names=EXPORTS):
        return {abi: list(names) for abi in ABIS}

    def test_the_members_the_app_reaches_by_name_pass(self):
        dex = self.parse(dex_classes())
        self.assertIn(SINK, dex)
        self.assertEqual(check_apk.check_dex(dex, self.exports()), [])
        self.assertEqual(check_apk.check_dex(dex, None), [])

    def test_a_member_renamed_or_removed_by_r8_fails(self):
        cases = {
            "onLog": (SINK, "onLog", "a"),
            "supportedChannelCounts": ("Lorg/pjsip/PjAudioDevInfo;", "supportedChannelCounts", "b"),
            "RefreshDevices": ("Lorg/pjsip/PjAudioDevInfo;", "RefreshDevices", None),
            "<init>": (WORKER, "<init>", None),
            "compareVersions": ("Lbr/com/starsonic/phone/Native;", "compareVersions", "c"),
        }
        for expected, (descriptor, name, new_name) in cases.items():
            with self.subTest(expected=expected):
                classes = dex_classes()
                members = [member for member in classes[descriptor] if member[1] != name]
                if new_name:
                    old = next(member for member in classes[descriptor] if member[1] == name)
                    members.append((old[0], new_name, old[2], old[3]))
                classes[descriptor] = members
                errors = check_apk.check_dex(self.parse(classes), None)
                self.assertEqual(len(errors), 1, errors)
                self.assertIn(expected, errors[0])
                self.assertIn(descriptor[1:-1].rsplit("/", 1)[-1], errors[0])

    def test_a_class_renamed_or_removed_by_r8_fails(self):
        # Também as classes dos natives: o Android acha cada função da ponte pelo nome da classe (Java_<classe>_<método>).
        for descriptor in (SINK, WORKER, "Lbr/com/starsonic/phone/update/UpdateStatusReceiver;",
                           "Lorg/pjsip/PjAudioDevInfo;", "Lbr/com/starsonic/phone/engine/NativeSipGateway;",
                           "Lbr/com/starsonic/phone/core/LoginFlowHandle;", "Lbr/com/starsonic/phone/Native;"):
            with self.subTest(descriptor=descriptor):
                classes = dex_classes()
                classes["Lz/z;"] = classes.pop(descriptor)
                errors = check_apk.check_dex(self.parse(classes), None)
                self.assertTrue(errors)
                self.assertTrue(all(descriptor in error for error in errors), errors)

    def test_the_worker_parameters_class_may_be_renamed(self):
        # O WorkManager pede o construtor (Context, WorkerParameters) pela classe que ele mesmo usa; o R8 pode renomear
        # a WorkerParameters, desde que o nome do worker e o construtor fiquem.
        classes = dex_classes()
        classes[WORKER] = [("Direct methods", "<init>", "(Landroid/content/Context;Lx/y;)V", PUBLIC | CONSTRUCTOR)]
        self.assertEqual(check_apk.check_dex(self.parse(classes), None), [])
        classes[WORKER] = [("Direct methods", "<init>", "(Landroid/content/Context;)V", PUBLIC | CONSTRUCTOR)]
        self.assertTrue(check_apk.check_dex(self.parse(classes), None))

    def test_a_native_of_the_app_without_its_jni_function_fails(self):
        # Um native do app que a libstarsonic.so de uma ABI não exporta: o Android não o acharia (UnsatisfiedLinkError).
        exports = self.exports()
        exports["armeabi-v7a"] = [name for name in EXPORTS if not name.endswith("compareVersions")]
        errors = check_apk.check_dex(self.parse(dex_classes()), exports)
        self.assertEqual(len(errors), 1, errors)
        self.assertIn("Java_br_com_starsonic_phone_Native_compareVersions", errors[0])
        self.assertIn("armeabi-v7a", errors[0])

    def test_jni_names(self):
        self.assertEqual(check_apk.jni_name("Lbr/com/starsonic/phone/Native;", "parseManifest"),
                         "Java_br_com_starsonic_phone_Native_parseManifest")
        self.assertEqual(check_apk.jni_name("Lbr/com/a_b/C$D;", "f_g"), "Java_br_com_a_1b_C_00024D_f_1g")

    def test_an_empty_dexdump_fails(self):
        self.assertTrue(check_apk.check_dex(check_apk.parse_dexdump(io.StringIO("")), None))


# Ferramentas falsas para o main: cada chamada vai para calls.txt; a saída vem dos arquivos de FAKE_DIR.
FAKE_TOOLS = {
    "aapt2": """\
        #!/usr/bin/env bash
        printf 'aapt2 %s\\n' "$*" >> "$FAKE_DIR/calls.txt"
        case "$1 $2" in
            "dump badging") cat "$FAKE_DIR/badging.txt";;
            "dump xmltree") cat "$FAKE_DIR/xmltree.txt";;
            *) exit 2;;
        esac
        """,
    "apksigner": """\
        #!/usr/bin/env bash
        printf 'apksigner %s\\n' "$*" >> "$FAKE_DIR/calls.txt"
        cat "$FAKE_DIR/certs.txt"
        exit "${FAKE_APKSIGNER_STATUS:-0}"
        """,
    "nm": """\
        #!/usr/bin/env bash
        printf 'nm %s\\n' "$*" >> "$FAKE_DIR/calls.txt"
        cat "$FAKE_DIR/nm.txt"
        """,
    "dexdump": """\
        #!/usr/bin/env bash
        printf 'dexdump %s\\n' "$*" >> "$FAKE_DIR/calls.txt"
        for dex in "$@"; do [ -f "$dex" ] || exit 3; done
        cat "$FAKE_DIR/dexdump.txt"
        """,
}


class MainTest(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.dir = pathlib.Path(self.tmp.name)
        self.tools = {}
        for name, script in FAKE_TOOLS.items():
            path = self.dir / name
            path.write_text(textwrap.dedent(script), encoding="utf-8")
            path.chmod(0o755)
            self.tools[name] = str(path)
        self.write("badging.txt", BADGING)
        self.write("xmltree.txt", XMLTREE)
        self.write("certs.txt", certs(CERT))
        self.write("nm.txt", nm_output())
        self.write("dexdump.txt", dexdump(dex_classes()))
        self.cert = self.write("cert.sha256", CERT + "\n")
        files = apk_files()
        files["classes2.dex"] = b"dex\n039\x00segundo"
        self.apk = write_apk(self.dir / "StarsonicPhone-android-0.1.0-rc.1.apk", files)
        environment = {"FAKE_DIR": str(self.dir)}
        patcher = mock.patch.dict(os.environ, environment)
        patcher.start()
        self.addCleanup(patcher.stop)
        os.environ.pop("GITHUB_ACTIONS", None)
        os.environ.pop("FAKE_APKSIGNER_STATUS", None)

    def tearDown(self):
        self.tmp.cleanup()

    def write(self, name, text):
        path = self.dir / name
        path.write_text(text, encoding="utf-8")
        return path

    def run_main(self, *extra, apk=None, release=True, all_tools=True):
        args = [str(apk or self.apk), "--version", VERSION, "--cert-sha256", str(self.cert),
                "--aapt2", self.tools["aapt2"], "--apksigner", self.tools["apksigner"]]
        if all_tools:
            args += ["--nm", self.tools["nm"], "--dexdump", self.tools["dexdump"]]
        if release:
            args.append("--release")
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_apk.main(args + list(extra))
        return code, out.getvalue(), err.getvalue()

    def calls(self):
        return (self.dir / "calls.txt").read_text(encoding="utf-8").splitlines()

    def test_a_good_release_apk_passes(self):
        code, out, err = self.run_main()
        self.assertEqual(code, 0, err)
        self.assertIn("ok:", out)
        self.assertIn(CERT, out)
        calls = self.calls()
        self.assertIn("aapt2 dump badging %s" % self.apk, calls)
        self.assertIn("aapt2 dump xmltree --file AndroidManifest.xml %s" % self.apk, calls)
        self.assertIn("apksigner verify --print-certs %s" % self.apk, calls)
        nm_calls = [call for call in calls if call.startswith("nm ")]
        self.assertEqual(len(nm_calls), 3, calls)
        for abi in ABIS:
            self.assertTrue(any(call.startswith("nm -D --defined-only ") and
                                call.endswith("lib/%s/libstarsonic.so" % abi) for call in nm_calls), nm_calls)
        dex_calls = [call for call in calls if call.startswith("dexdump ")]
        self.assertEqual(len(dex_calls), 1, calls)
        self.assertIn("classes.dex", dex_calls[0])
        self.assertIn("classes2.dex", dex_calls[0])

    def test_the_debug_apk_of_one_abi_without_the_release_checks(self):
        self.write("badging.txt", DEBUGGABLE.replace("native-code: 'arm64-v8a' 'armeabi-v7a' 'x86_64'",
                                                     "native-code: 'x86_64'"))
        self.write("xmltree.txt", XMLTREE + NETWORK_SECURITY_CONFIG)
        apk = write_apk(self.dir / "app-debug.apk", apk_files(("x86_64",)))
        code, out, err = self.run_main("--abis", "x86_64", apk=apk, release=False, all_tools=False)
        self.assertEqual(code, 0, err)
        self.assertFalse(any("xmltree" in call or call.startswith(("nm ", "dexdump ")) for call in self.calls()))

    def test_abis_may_be_separated_by_commas(self):
        code, _, err = self.run_main("--abis", "arm64-v8a,armeabi-v7a,x86_64")
        self.assertEqual(code, 0, err)

    def test_every_problem_is_listed(self):
        files = apk_files()
        del files["lib/arm64-v8a/libstarsonic.so"]
        files["assets/sobre.txt"] = b"MicroSIP"
        apk = write_apk(self.dir / "ruim.apk", files)
        self.write("badging.txt", BADGING.replace("label='Starsonic' icon=''", "label='Starsonic Phone' icon=''"))
        self.write("certs.txt", certs(OTHER_CERT))
        self.write("xmltree.txt", XMLTREE + CLEARTEXT)
        code, _, err = self.run_main("--abis", "arm64-v8a", "armeabi-v7a", "x86_64", apk=apk)
        self.assertEqual(code, 1)
        for expected in ("lib/arm64-v8a/libstarsonic.so", "assets/sobre.txt", "label='Starsonic'", OTHER_CERT,
                         "usesCleartextTraffic"):
            self.assertIn(expected, err)

    def test_a_signature_that_does_not_verify_fails(self):
        self.write("certs.txt", "DOES NOT VERIFY\nERROR: APK Signature Scheme v2 signer #1: digest mismatch\n")
        with mock.patch.dict(os.environ, {"FAKE_APKSIGNER_STATUS": "1"}):
            code, _, err = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("apksigner", err)
        self.assertIn("digest mismatch", err)

    def test_problems_become_annotations_in_github_actions(self):
        self.write("certs.txt", certs(OTHER_CERT))
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            code, out, _ = self.run_main()
        self.assertEqual(code, 1)
        self.assertIn("::error title=check_apk::", out)
        with mock.patch.dict(os.environ, {"GITHUB_ACTIONS": "true"}):
            self.write("certs.txt", certs(CERT))
            code, out, _ = self.run_main()
        self.assertEqual(code, 0)
        self.assertIn("::notice title=check_apk::", out)

    def test_usage_errors(self):
        self.write("cert.sha256", "nao e um sha-256\n")
        self.assertEqual(self.run_main()[0], 2)
        self.write("cert.sha256", CERT)
        self.assertEqual(self.run_main(apk=self.dir / "nao-existe.apk")[0], 2)
        self.write("nao-e-zip.apk", "texto")
        self.assertEqual(self.run_main(apk=self.dir / "nao-e-zip.apk")[0], 2)
        out, err = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(out), contextlib.redirect_stderr(err):
            code = check_apk.main([str(self.apk), "--version", "0.1", "--cert-sha256", str(self.cert),
                                   "--aapt2", self.tools["aapt2"], "--apksigner", self.tools["apksigner"]])
        self.assertEqual(code, 2)
        self.assertIn("0.1", err.getvalue())


if __name__ == "__main__":
    unittest.main()
