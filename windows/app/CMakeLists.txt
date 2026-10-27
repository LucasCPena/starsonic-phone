cmake_minimum_required(VERSION 3.20)
# C: o miniz.c (o .xlsx das planilhas de contatos).
project(starsonic_phone_windows C CXX RC)

# O StarsonicPhone.exe do app novo (Win32, x86): a janela com o WebView2, o nucleo do app de PC (starsonic/desktop), o
# controlador e o motor (starsonic/phone, o mesmo do Android) e o nucleo (starsonic/core). As dependencias vem do
# build/Build-Deps.ps1 (o pjproject com o libpjproject e o pjsua2, o vcpkg x86-windows-static e o SDK do WebView2);
# quem chama e o build/Build-Windows.ps1:
#   cmake -S windows/app -B <build> -A Win32 -DPJPROJECT_DIR=<work>/pjproject
#         -DVCPKG_INSTALLED_DIR=<work>/vcpkg/installed/x86-windows-static -DWEBVIEW2_DIR=<work>/webview2
#         -DSTARSONIC_VERSION=0.1.0-rc.1 [-DSTARSONIC_TEST_HOOKS=ON]
if(NOT MSVC OR NOT CMAKE_SIZEOF_VOID_P EQUAL 4)
  message(FATAL_ERROR "O app do Windows e Win32 (x86) com o MSVC: cmake -A Win32")
endif()

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)
# O runtime estatico (/MT), como o pjproject (Release-Static) e o vcpkg (x86-windows-static).
set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")

set(PJPROJECT_DIR "" CACHE PATH "O pjproject compilado pelo Build-Deps.ps1")
set(VCPKG_INSTALLED_DIR "" CACHE PATH "O <vcpkg>/installed/x86-windows-static")
set(WEBVIEW2_DIR "" CACHE PATH "O SDK do WebView2 extraido pelo Build-Deps.ps1 (include/ e x86/)")
set(STARSONIC_VERSION "0.0.0" CACHE STRING "A versao (X.Y.Z ou X.Y.Z-rc.N)")
set(STARSONIC_CHANNEL "estavel" CACHE STRING "O canal de atualizacao (estavel ou teste)")
option(STARSONIC_TEST_HOOKS "Build de teste: o STARSONIC_PERFIL e as ferramentas do desenvolvedor" OFF)

foreach(dir PJPROJECT_DIR VCPKG_INSTALLED_DIR WEBVIEW2_DIR)
  if(NOT ${dir} OR NOT IS_DIRECTORY "${${dir}}")
    message(FATAL_ERROR "Informe -D${dir}=<pasta> (veja build/Build-Windows.ps1)")
  endif()
endforeach()

if(NOT STARSONIC_VERSION MATCHES "^([0-9]+)\\.([0-9]+)\\.([0-9]+)(-rc\\.([1-9][0-9]*))?$")
  message(FATAL_ERROR "Versao invalida: ${STARSONIC_VERSION} (use X.Y.Z ou X.Y.Z-rc.N)")
endif()
set(STARSONIC_VERSION_RC "${CMAKE_MATCH_5}")
if(NOT STARSONIC_VERSION_RC)
  set(STARSONIC_VERSION_RC 0)
endif()
set(STARSONIC_VERSION_COMMA "${CMAKE_MATCH_1},${CMAKE_MATCH_2},${CMAKE_MATCH_3},${STARSONIC_VERSION_RC}")
if(STARSONIC_CHANNEL STREQUAL "teste")
  set(STARSONIC_CHANNEL_TEST 1)
else()
  set(STARSONIC_CHANNEL_TEST 0)
endif()
if(STARSONIC_TEST_HOOKS)
  set(STARSONIC_TEST_HOOKS_VALUE 1)
else()
  set(STARSONIC_TEST_HOOKS_VALUE 0)
endif()

set(REPO_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../..)
get_filename_component(REPO_DIR "${REPO_DIR}" ABSOLUTE)
set(STARSONIC_DIR ${REPO_DIR}/starsonic)

# Os caminhos absolutos dos recursos (o compilador de recursos nao resolve caminhos relativos ao .rc de forma
# confiavel), com as barras do Windows dobradas.
function(rc_path out file)
  file(TO_NATIVE_PATH "${file}" native)
  string(REPLACE "\\" "\\\\" native "${native}")
  set(${out} "\"${native}\"" PARENT_SCOPE)
endfunction()
set(GENERATED_DIR ${CMAKE_CURRENT_BINARY_DIR}/generated)

# O perfil vai para o executavel sem os comentarios, como no Build-App.ps1 (a mesma regra do leitor: tudo depois do
# primeiro ';' sai; as linhas com '#' no comeco tambem). Os comentarios citam o app antigo, que nao pode aparecer no
# executavel (build/check_branding.py).
set(PROFILE_SOURCE ${REPO_DIR}/branding/perfil.ini)
set_property(DIRECTORY APPEND PROPERTY CMAKE_CONFIGURE_DEPENDS ${PROFILE_SOURCE})
file(READ ${PROFILE_SOURCE} profile_text)
string(REPLACE "\r" "" profile_text "${profile_text}")
string(REGEX REPLACE ";[^\n]*" "" profile_text "${profile_text}")
string(REGEX REPLACE "(^|\n)[ \t]*#[^\n]*" "\\1" profile_text "${profile_text}")
string(REGEX REPLACE "[ \t]+\n" "\n" profile_text "${profile_text}")
string(REGEX REPLACE "\n\n+" "\n" profile_text "${profile_text}")
file(WRITE ${GENERATED_DIR}/perfil.ini "${profile_text}")

# Os icones no estilo novo (windows/app/res/gerar-icones.mjs).
rc_path(STARSONIC_ICON_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/app.ico)
rc_path(STARSONIC_TRAY_CONNECTED_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/bandeja-conectado.ico)
rc_path(STARSONIC_TRAY_OFFLINE_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/bandeja-sem-conexao.ico)
rc_path(STARSONIC_TRAY_DND_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/bandeja-nao-perturbe.ico)
rc_path(STARSONIC_TRAY_MISSED_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/bandeja-perdida.ico)
rc_path(STARSONIC_TRAY_RINGING_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/bandeja-tocando.ico)
rc_path(STARSONIC_TRAY_INCALL_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/bandeja-em-ligacao.ico)
rc_path(STARSONIC_PROFILE_PATH ${GENERATED_DIR}/perfil.ini)
rc_path(STARSONIC_MANIFEST_PATH ${CMAKE_CURRENT_SOURCE_DIR}/res/app.manifest)
configure_file(${CMAKE_CURRENT_SOURCE_DIR}/res/app_build.h.in ${GENERATED_DIR}/app_build.h @ONLY)

file(GLOB APP_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/src/*.cpp)
file(GLOB CORE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/core/*.cpp)
file(GLOB DESKTOP_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/desktop/*.cpp)
# O motor inteiro (SipEngine, CallEngine, o controlador e o AudioDeviceName com o ramo do Windows).
file(GLOB PHONE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/phone/*.cpp)

# O miniz 3.0.2 (MIT, starsonic/third_party/miniz, como veio): o zip do .xlsx das planilhas de contatos
# (starsonic/desktop/Planilha.cpp). Uma biblioteca so com o miniz.c, sem as opcoes de aviso do app, com o mesmo runtime
# estatico (/MT). O zip e sempre na memoria: sem as funcoes de arquivo (MINIZ_NO_STDIO, tambem para quem inclui o
# miniz.h).
add_library(miniz STATIC ${STARSONIC_DIR}/third_party/miniz/miniz.c)
target_compile_definitions(miniz PUBLIC MINIZ_NO_STDIO)

# Do starsonic/win, so o que e Win32 puro (sem MFC): a senha da rc.7 e o atualizador (versao.json, HTTPS, SHA-256 e
# o aviso de falha de TLS do PJSIP).
add_executable(StarsonicPhone WIN32
  ${APP_SOURCES} ${CORE_SOURCES} ${DESKTOP_SOURCES} ${PHONE_SOURCES}
  ${STARSONIC_DIR}/win/LegacyCrypto.cpp
  ${STARSONIC_DIR}/win/Updater.cpp
  ${STARSONIC_DIR}/win/Http.cpp
  ${STARSONIC_DIR}/win/Sha256.cpp
  ${STARSONIC_DIR}/win/TlsWatch.cpp
  ${CMAKE_CURRENT_SOURCE_DIR}/res/app.rc)

target_include_directories(StarsonicPhone PRIVATE
  ${CMAKE_CURRENT_SOURCE_DIR}/src
  ${CMAKE_CURRENT_SOURCE_DIR}/res
  ${GENERATED_DIR}
  ${STARSONIC_DIR}/core
  ${STARSONIC_DIR}/desktop
  ${STARSONIC_DIR}/phone
  ${STARSONIC_DIR}/win
  ${STARSONIC_DIR}/third_party
  ${REPO_DIR}/branding
  ${WEBVIEW2_DIR}/include
  ${VCPKG_INSTALLED_DIR}/include
  ${PJPROJECT_DIR}/pjlib/include
  ${PJPROJECT_DIR}/pjlib-util/include
  ${PJPROJECT_DIR}/pjnath/include
  ${PJPROJECT_DIR}/pjmedia/include
  ${PJPROJECT_DIR}/pjsip/include)

target_compile_definitions(StarsonicPhone PRIVATE
  UNICODE _UNICODE NOMINMAX _WIN32_WINNT=0x0A00 WINVER=0x0A00
  _CRT_SECURE_NO_WARNINGS)

# /utf-8: os comentarios do motor tem acentos (os literais sao ASCII: build/check_source_text.py).
target_compile_options(StarsonicPhone PRIVATE "$<$<COMPILE_LANGUAGE:CXX>:/W4;/EHsc;/utf-8;/MP>")

target_link_directories(StarsonicPhone PRIVATE
  ${PJPROJECT_DIR}/lib
  ${PJPROJECT_DIR}/pjsip/lib
  ${VCPKG_INSTALLED_DIR}/lib
  ${WEBVIEW2_DIR}/x86)

target_link_libraries(StarsonicPhone PRIVATE
  miniz
  pjsua2-lib-i386-Win32-vc14-Release-Static
  libpjproject-i386-Win32-vc14-Release-Static
  opus bcg729 libssl libcrypto sqlite3
  WebView2LoaderStatic
  ws2_32 iphlpapi winmm crypt32 advapi32 user32 gdi32 shell32 shlwapi ole32 oleaut32 uuid version
  dwmapi shcore comctl32 winhttp dnsapi)

# O manifesto vem do app.rc (DPI por monitor v2 e Common Controls 6): o linker nao gera outro.
target_link_options(StarsonicPhone PRIVATE /MANIFEST:NO)
set_target_properties(StarsonicPhone PROPERTIES OUTPUT_NAME StarsonicPhone)
