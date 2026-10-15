#include "test_support.h"
#include "UpdateManifest.h"

#include <string>

using namespace starsonic;

namespace {

const std::string P = "https://github.com/acme/starsonic-phone/releases/download/";
const std::string kSha = "ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789ABCDEF0123456789";

// O endereço permitido do APK no app Android (spec 7.7): os assets das tags android-v*.
const std::string kAndroidPrefix = "https://github.com/LucasCPena/starsonic-phone/releases/download/android-v";
const std::string kAndroidReleases = "https://github.com/LucasCPena/starsonic-phone/releases/download/";

// Valores em JSON cru; vazio = campo ausente.
struct Fields {
    std::string versao = "\"1.0.1\"";
    std::string instalador = "\"" + P + "v1.0.1/StarsonicPhone-1.0.1-setup.exe\"";
    std::string sha256 = "\"" + kSha + "\"";
    std::string notas = "\"ok\"";
};

std::string ToJson(const Fields& fields) {
    std::string json = "{";
    bool first = true;
    auto add = [&json, &first](const char* key, const std::string& value) {
        if (value.empty()) return;
        if (!first) json += ",";
        first = false;
        json += std::string("\"") + key + "\":" + value;
    };
    add("versao", fields.versao);
    add("instalador", fields.instalador);
    add("sha256", fields.sha256);
    add("notas", fields.notas);
    return json + "}";
}

bool Rejects(const std::string& json) {
    Manifest manifest;
    std::string error;
    const bool ok = ParseManifest(json, P, &manifest, &error);
    return !ok && !error.empty();
}

Version V(int major, int minor, int patch, int rc = 0) {
    Version version;
    version.major = major;
    version.minor = minor;
    version.patch = patch;
    version.rc = rc;
    return version;
}

bool IsHighSurrogate(wchar_t ch) {
    return static_cast<unsigned long>(ch) >= 0xD800 && static_cast<unsigned long>(ch) <= 0xDBFF;
}

bool IsLowSurrogate(wchar_t ch) {
    return static_cast<unsigned long>(ch) >= 0xDC00 && static_cast<unsigned long>(ch) <= 0xDFFF;
}

}  // namespace

TEST_CASE("ParseVersion reads final and release candidate versions") {
    Version version;
    REQUIRE(ParseVersion("1.0.1", &version));
    CHECK(version.major == 1);
    CHECK(version.minor == 0);
    CHECK(version.patch == 1);
    CHECK(version.rc == 0);
    REQUIRE(ParseVersion("1.0.1-rc.2", &version));
    CHECK(version.patch == 1);
    CHECK(version.rc == 2);
    REQUIRE(ParseVersion("12.34.56", &version));
    CHECK(version.major == 12);
    CHECK(version.minor == 34);
    CHECK(version.patch == 56);
}

TEST_CASE("ParseVersion rejects other formats") {
    Version version;
    CHECK_FALSE(ParseVersion("1.0", &version));
    CHECK_FALSE(ParseVersion("v1.0.0", &version));
    CHECK_FALSE(ParseVersion("1.0.0-rc", &version));
    CHECK_FALSE(ParseVersion("1.0.0-beta.1", &version));
    CHECK_FALSE(ParseVersion("1.0.0-rc.0", &version));
    CHECK_FALSE(ParseVersion("", &version));
    CHECK_FALSE(ParseVersion("1.0.0.0", &version));
    CHECK_FALSE(ParseVersion("1..0", &version));
    CHECK_FALSE(ParseVersion("1.0.0-rc.1x", &version));
    CHECK_FALSE(ParseVersion(" 1.0.0", &version));
    CHECK_FALSE(ParseVersion("1.0.99999999999", &version));
}

TEST_CASE("CompareVersions orders releases") {
    CHECK(CompareVersions(V(1, 0, 1), V(1, 0, 0)) > 0);
    CHECK(CompareVersions(V(1, 0, 0), V(1, 0, 1)) < 0);
    CHECK(CompareVersions(V(1, 0, 1), V(1, 0, 1, 9)) > 0);
    CHECK(CompareVersions(V(1, 0, 1, 9), V(1, 0, 1)) < 0);
    CHECK(CompareVersions(V(1, 0, 1, 2), V(1, 0, 1, 1)) > 0);
    CHECK(CompareVersions(V(1, 1, 0), V(1, 0, 9)) > 0);
    CHECK(CompareVersions(V(2, 0, 0), V(1, 9, 9)) > 0);
    CHECK(CompareVersions(V(1, 0, 1, 2), V(1, 0, 1, 2)) == 0);
    CHECK(CompareVersions(V(1, 0, 1), V(1, 0, 1)) == 0);
}

TEST_CASE("ParseManifest valid") {
    Manifest manifest;
    std::string error = "antes";
    REQUIRE(ParseManifest(ToJson(Fields()), P, &manifest, &error));
    CHECK(error == "");
    CHECK(manifest.versionText == "1.0.1");
    CHECK(manifest.version.patch == 1);
    CHECK(manifest.installerUrl == P + "v1.0.1/StarsonicPhone-1.0.1-setup.exe");
    CHECK(manifest.sha256 == "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
    CHECK(manifest.notes == L"ok");
}

TEST_CASE("ParseManifest accepts a release candidate and ignores unknown fields") {
    Fields fields;
    fields.versao = "\"1.0.2-rc.1\"";
    fields.instalador = "\"" + P + "v1.0.2-rc.1/StarsonicPhone-1.0.2-rc.1-setup.exe\"";
    std::string json = ToJson(fields);
    json.insert(json.size() - 1, ",\"futuro\":[1,2]");
    Manifest manifest;
    REQUIRE(ParseManifest(json, P, &manifest, nullptr));
    CHECK(manifest.version.rc == 1);
}

TEST_CASE("ParseManifest rejects untrusted or malformed manifests") {
    Fields fields;
    fields.instalador = "\"https://evil.example/x.exe\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.instalador = "\"http://github.com/acme/starsonic-phone/releases/download/v1.0.1/x.exe\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.instalador = "\"" + P + "\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.instalador = "\"" + P + "../../../outro/repo/releases/download/v1/x.exe\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.instalador = "\"" + P + "v1.0.1/x.exe?y=1\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.instalador = "1";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.instalador = "";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.sha256 = "\"" + kSha.substr(1) + "\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.sha256 = "\"g" + kSha.substr(1) + "\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.sha256 = "";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.versao = "";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.versao = "101";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.versao = "\"1.0\"";
    CHECK(Rejects(ToJson(fields)));
    fields = Fields();
    fields.notas = "42";
    CHECK(Rejects(ToJson(fields)));
    CHECK(Rejects("{\"versao\":"));
    CHECK(Rejects("[1,2]"));
    CHECK(Rejects(""));
}

TEST_CASE("ParseManifest accepts the Android installer prefix") {
    Fields fields;
    fields.versao = "\"0.1.0-rc.2\"";
    fields.instalador = "\"" + kAndroidPrefix + "0.1.0-rc.2/StarsonicPhone-android-0.1.0-rc.2.apk\"";
    Manifest manifest;
    std::string error = "antes";
    REQUIRE(ParseManifest(ToJson(fields), kAndroidPrefix, &manifest, &error));
    CHECK(error == "");
    CHECK(manifest.versionText == "0.1.0-rc.2");
    CHECK(manifest.version.minor == 1);
    CHECK(manifest.version.rc == 2);
    CHECK(manifest.installerUrl ==
          kAndroidReleases + "android-v0.1.0-rc.2/StarsonicPhone-android-0.1.0-rc.2.apk");
    CHECK(manifest.sha256 == "abcdef0123456789abcdef0123456789abcdef0123456789abcdef0123456789");
}

TEST_CASE("ParseManifest rejects a Windows installer for the Android prefix") {
    Fields fields;
    fields.instalador = "\"" + kAndroidReleases + "v1.0.1/StarsonicPhone-1.0.1-setup.exe\"";
    Manifest manifest;
    std::string error;
    CHECK_FALSE(ParseManifest(ToJson(fields), kAndroidPrefix, &manifest, &error));
    CHECK(error.find("instalador") != std::string::npos);

    // Nem o APK de outra conta, nem por HTTP, nem saindo da pasta da tag.
    fields.instalador = "\"https://github.com/outra/starsonic-phone/releases/download/android-v0.1.0/x.apk\"";
    CHECK_FALSE(ParseManifest(ToJson(fields), kAndroidPrefix, &manifest, nullptr));
    fields.instalador = "\"http://github.com/LucasCPena/starsonic-phone/releases/download/android-v0.1.0/x.apk\"";
    CHECK_FALSE(ParseManifest(ToJson(fields), kAndroidPrefix, &manifest, nullptr));
    fields.instalador = "\"" + kAndroidPrefix + "0.1.0/../../v1.0.1/StarsonicPhone-1.0.1-setup.exe\"";
    CHECK_FALSE(ParseManifest(ToJson(fields), kAndroidPrefix, &manifest, nullptr));
    CHECK(manifest.installerUrl.empty());
}

TEST_CASE("failed manifest leaves output untouched") {
    Manifest manifest;
    REQUIRE(ParseManifest(ToJson(Fields()), P, &manifest, nullptr));
    Fields fields;
    fields.versao = "\"2.0.0\"";
    fields.sha256 = "";
    CHECK_FALSE(ParseManifest(ToJson(fields), P, &manifest, nullptr));
    CHECK(manifest.versionText == "1.0.1");
}

TEST_CASE("notes keep UTF-8 and are truncated") {
    Fields fields;
    fields.notas = "\"Corre\xC3\xA7\xC3\xA3o de \xC3\xA1udio\"";
    Manifest manifest;
    REQUIRE(ParseManifest(ToJson(fields), P, &manifest, nullptr));
    CHECK(manifest.notes == L"Corre\u00e7\u00e3o de \u00e1udio");

    fields.notas = "\"" + std::string(600, 'a') + "\"";
    REQUIRE(ParseManifest(ToJson(fields), P, &manifest, nullptr));
    CHECK(manifest.notes.size() == 501);
    CHECK(manifest.notes[499] == L'a');
    CHECK(manifest.notes[500] == L'\u2026');

    fields.notas = "\"" + std::string(500, 'a') + "\"";
    REQUIRE(ParseManifest(ToJson(fields), P, &manifest, nullptr));
    CHECK(manifest.notes == std::wstring(500, L'a'));

    fields.notas = "";
    REQUIRE(ParseManifest(ToJson(fields), P, &manifest, nullptr));
    CHECK(manifest.notes == L"");
}

TEST_CASE("truncated notes never split a surrogate pair") {
    std::string notes = "a";
    for (int i = 0; i < 600; ++i) notes += "\xF0\x9F\x98\x80";
    Fields fields;
    fields.notas = "\"" + notes + "\"";
    Manifest manifest;
    REQUIRE(ParseManifest(ToJson(fields), P, &manifest, nullptr));
    REQUIRE_FALSE(manifest.notes.empty());
    CHECK(manifest.notes.size() <= 501);
    CHECK(manifest.notes[manifest.notes.size() - 1] == L'\u2026');
    for (size_t i = 0; i + 1 < manifest.notes.size(); ++i) {
        if (IsHighSurrogate(manifest.notes[i])) CHECK(IsLowSurrogate(manifest.notes[i + 1]));
    }
}
