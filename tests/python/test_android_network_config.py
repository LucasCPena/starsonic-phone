"""O HTTP sem TLS fica só no build de debug do app Android, e só para 10.0.2.2 (o computador do emulador, onde o CI
serve o canal de teste do atualizador): o manifesto principal, o do release, não libera HTTP nem aponta para um
network security config, e nenhum fica fora de src/debug.
"""
import pathlib
import unittest
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parents[2]
SOURCES = ROOT / "android" / "app" / "src"
ANDROID = "{http://schemas.android.com/apk/res/android}"


def application(manifest):
    return ET.parse(manifest).getroot().find("application")


class AndroidNetworkConfigTest(unittest.TestCase):
    def test_the_release_does_not_allow_http(self):
        for manifest in SOURCES.glob("*/AndroidManifest.xml"):
            if manifest.parent.name == "debug":
                continue
            found = application(manifest)
            if found is None:
                continue
            self.assertIsNone(found.get(ANDROID + "usesCleartextTraffic"), manifest)
            self.assertIsNone(found.get(ANDROID + "networkSecurityConfig"), manifest)

    def test_only_the_debug_build_has_a_network_security_config(self):
        configs = sorted(path.relative_to(SOURCES).as_posix() for path in SOURCES.glob("*/res/xml/*.xml")
                         if ET.parse(path).getroot().tag == "network-security-config")
        self.assertEqual(configs, ["debug/res/xml/network_security_config.xml"])
        self.assertEqual(application(SOURCES / "debug" / "AndroidManifest.xml").get(ANDROID + "networkSecurityConfig"),
                         "@xml/network_security_config")

    def test_the_debug_build_allows_http_only_to_the_emulator_host(self):
        root = ET.parse(SOURCES / "debug" / "res" / "xml" / "network_security_config.xml").getroot()
        self.assertIsNone(root.find("base-config"), "um base-config muda o padrão de todos os endereços")
        self.assertIsNone(root.find("debug-overrides"))
        configs = root.findall("domain-config")
        self.assertEqual(len(configs), 1)
        self.assertEqual(configs[0].get("cleartextTrafficPermitted"), "true")
        self.assertEqual(configs[0].findall("domain-config"), [])
        domains = [(domain.text.strip(), domain.get("includeSubdomains")) for domain in configs[0].findall("domain")]
        self.assertEqual(domains, [("10.0.2.2", "false")])


if __name__ == "__main__":
    unittest.main()
