#pragma once
// O modulo H.264 da Cisco fixado (spec da videochamada, 6.3): os mesmos valores do openh264 do build/deps.lock
// (tests/python/test_deps_lock.py confere). Impressoes SHA-256 em hex minusculo: a do .bz2 baixado e a do .dll.
// Para trocar a versao: docs/build-notes.md.
#include "H264Module.h"

inline const H264Pin kOpenH264Pin{
    "2.6.0",
    "http://ciscobinary.openh264.org/openh264-2.6.0-win32.dll.bz2",
    "openh264-2.6.0-win32.dll",
    "",
    ""};
