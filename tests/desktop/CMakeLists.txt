cmake_minimum_required(VERSION 3.16)
project(starsonic_desktop_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Os testes do app de PC (starsonic/desktop): so C++ portatil, sem pjproject. O orquestrador (DesktopApp) usa o
# controlador de ligacoes: o CallController.cpp entra aqui (sem o SipEngine.cpp, o CallEngine.cpp e o pjproject), e
# os testes usam o motor falso de tests/phone/fake_call_engine.h (Ruling 2 da W1).
#   cmake -S tests/desktop -B <build> && cmake --build <build> && <build>/desktop_tests
set(STARSONIC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../starsonic)

file(GLOB STARSONIC_CORE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/core/*.cpp)
file(GLOB STARSONIC_DESKTOP_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/desktop/*.cpp)
file(GLOB DESKTOP_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp)

# A migracao da rc.7 le o call_log.db do MicroSIP: no Linux o libsqlite3-dev; no Windows, o do vcpkg
# (x86-windows-static: -DCMAKE_PREFIX_PATH=<work>/vcpkg/installed/x86-windows-static), com o runtime estatico (/MT)
# dele e do app.
if(MSVC)
  set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
endif()
find_package(SQLite3 REQUIRED)
find_package(Threads REQUIRED)

add_executable(desktop_tests main.cpp ${DESKTOP_TEST_SOURCES} ${STARSONIC_CORE_SOURCES} ${STARSONIC_DESKTOP_SOURCES}
  ${STARSONIC_DIR}/phone/CallController.cpp)
target_include_directories(desktop_tests PRIVATE
  ${STARSONIC_DIR}/core
  ${STARSONIC_DIR}/desktop
  ${STARSONIC_DIR}/phone
  ${STARSONIC_DIR}/third_party
  ${STARSONIC_DIR}/../branding
  ${CMAKE_CURRENT_SOURCE_DIR}/..)

target_link_libraries(desktop_tests PRIVATE SQLite::SQLite3 Threads::Threads)

if(MSVC)
  target_compile_options(desktop_tests PRIVATE /W4 /EHsc)
else()
  target_compile_options(desktop_tests PRIVATE -Wall -Wextra)
endif()

if(WIN32)
  # O disco, o cifrador e o diagnostico de verdade do executavel (windows/app/src): a gravacao atomica, o DPAPI, o
  # diagnostico.log, os links tel:/sip:/callto:, a instancia unica, o estado da bandeja e do aviso, as permissoes do
  # WebView2, o Iniciar com o Windows e o Enviar diagnostico.
  set(WINDOWS_APP_SRC ${STARSONIC_DIR}/../windows/app/src)
  target_sources(desktop_tests PRIVATE
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_dpapi_cipher.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_win_files.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_diag_log.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_links.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_single_instance.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_shell_state.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_autostart.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/../win/test_diagnostics.cpp
    ${WINDOWS_APP_SRC}/DpapiCipher.cpp
    ${WINDOWS_APP_SRC}/WinFiles.cpp
    ${WINDOWS_APP_SRC}/DiagLog.cpp
    ${WINDOWS_APP_SRC}/Links.cpp
    ${WINDOWS_APP_SRC}/SingleInstance.cpp
    ${WINDOWS_APP_SRC}/ShellState.cpp
    ${WINDOWS_APP_SRC}/WebPermissions.cpp
    ${WINDOWS_APP_SRC}/Autostart.cpp
    ${WINDOWS_APP_SRC}/Diagnostics.cpp)
  target_include_directories(desktop_tests PRIVATE ${WINDOWS_APP_SRC})
  target_compile_definitions(desktop_tests PRIVATE UNICODE _UNICODE NOMINMAX WIN32_LEAN_AND_MEAN)
  target_link_libraries(desktop_tests PRIVATE crypt32 user32 advapi32 shell32)
endif()

enable_testing()
add_test(NAME desktop_tests COMMAND desktop_tests)
