# O teste da senha da rc.7 (so no Windows): cifra com o original do MicroSIP 3.22 (o MFC::CCrypto de
# microsip/lib/Crypto.cpp e uma copia do IniEncrypt de microsip/settings.cpp, com MFC) e decifra com o LegacyDecrypt
# de starsonic/win/LegacyCrypto.cpp (CryptoAPI pura). Numa pasta propria porque o CMAKE_MFC_FLAG vale para todos os
# alvos da pasta: os outros testes ficam sem MFC.
set(CMAKE_MFC_FLAG 2)   # MFC em DLL, com o runtime /MD de sempre

set(MICROSIP_DIR ${STARSONIC_DIR}/../microsip)

add_executable(legacy_crypto_tests
  ${CMAKE_CURRENT_SOURCE_DIR}/main.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/../test_legacy_crypto.cpp
  ${MICROSIP_DIR}/lib/Crypto.cpp)
# O LegacyDecrypt devolve std::optional (C++17, como o app novo); os outros testes daqui ficam no C++14.
set_target_properties(legacy_crypto_tests PROPERTIES CXX_STANDARD 17 CXX_STANDARD_REQUIRED ON)
target_include_directories(legacy_crypto_tests PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}             # o stdafx.h minimo (antes de tudo: o Crypto.cpp inclui "stdafx.h")
  ${MICROSIP_DIR}/lib
  ${STARSONIC_DIR}/win
  ${STARSONIC_DIR}/third_party
  ${CMAKE_CURRENT_SOURCE_DIR}/../..)      # test_support.h
target_compile_definitions(legacy_crypto_tests PRIVATE
  UNICODE _UNICODE _AFXDLL
  STARSONIC_REPO_DIR="${STARSONIC_DIR}/..")
target_compile_options(legacy_crypto_tests PRIVATE /EHsc /W3)
target_link_libraries(legacy_crypto_tests PRIVATE advapi32)

add_test(NAME legacy_crypto_tests COMMAND legacy_crypto_tests)
