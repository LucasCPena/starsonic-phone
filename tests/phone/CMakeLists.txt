cmake_minimum_required(VERSION 3.16)
project(starsonic_phone_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# O pjproject vem de build/linux/build-pjproject.sh:
#   cmake -S tests/phone -B <build> -DPJPROJECT_PREFIX=<prefixo do make install>
if(NOT PJPROJECT_PREFIX)
  message(FATAL_ERROR "Informe -DPJPROJECT_PREFIX=<prefixo do pjproject> (veja build/linux/build-pjproject.sh)")
endif()
get_filename_component(PJPROJECT_PREFIX "${PJPROJECT_PREFIX}" ABSOLUTE)
set(ENV{PKG_CONFIG_PATH} "${PJPROJECT_PREFIX}/lib/pkgconfig:$ENV{PKG_CONFIG_PATH}")

find_package(PkgConfig REQUIRED)
pkg_check_modules(PJ REQUIRED IMPORTED_TARGET libpjproject)

set(STARSONIC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../starsonic)

file(GLOB STARSONIC_CORE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/core/*.cpp)
file(GLOB STARSONIC_PHONE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/phone/*.cpp)
file(GLOB PHONE_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp)
# Os testes do controlador de ligações (call_controller_main.cpp e test_call_controller*.cpp) vão no
# call_controller_tests, abaixo, e não no phone_tests.
list(FILTER PHONE_TEST_SOURCES EXCLUDE REGEX "/(call_controller_main|test_call_controller[^/]*)\\.cpp$")
file(GLOB CALL_CONTROLLER_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/test_call_controller*.cpp)
if(NOT STARSONIC_PHONE_SOURCES)
  message(FATAL_ERROR "Sem fontes em ${STARSONIC_DIR}/phone")
endif()

add_executable(phone_tests ${PHONE_TEST_SOURCES} ${STARSONIC_CORE_SOURCES} ${STARSONIC_PHONE_SOURCES})
target_include_directories(phone_tests PRIVATE
  ${STARSONIC_DIR}/core
  ${STARSONIC_DIR}/phone
  ${STARSONIC_DIR}/third_party
  ${CMAKE_CURRENT_SOURCE_DIR}/..)
target_compile_definitions(phone_tests PRIVATE
  STARSONIC_REPO_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../..")
target_compile_options(phone_tests PRIVATE -Wall -Wextra)
# O libpjproject.pc põe speex, srtp, resample e uuid só em Libs.private; as bibliotecas do PJSIP são
# estáticas, então o link precisa da lista completa (pkg-config --static).
target_link_libraries(phone_tests PRIVATE PkgConfig::PJ ${PJ_STATIC_LDFLAGS})

# O controlador de ligações sem o motor: só o núcleo, o CallController.cpp e os testes, sem o
# SipEngine.cpp, o CallEngine.cpp (o SipCallEngine) e o pjproject (Ruling 1 da W1: o ctest do job
# phone-linux do android.yml roda os dois executáveis).
find_package(Threads REQUIRED)
add_executable(call_controller_tests
  ${CMAKE_CURRENT_SOURCE_DIR}/call_controller_main.cpp
  ${CALL_CONTROLLER_TEST_SOURCES}
  ${STARSONIC_CORE_SOURCES}
  ${STARSONIC_DIR}/phone/CallController.cpp)
target_include_directories(call_controller_tests PRIVATE
  ${STARSONIC_DIR}/core
  ${STARSONIC_DIR}/phone
  ${STARSONIC_DIR}/third_party
  ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_options(call_controller_tests PRIVATE -Wall -Wextra)
target_link_libraries(call_controller_tests PRIVATE Threads::Threads)

enable_testing()
add_test(NAME phone_tests COMMAND phone_tests)
add_test(NAME call_controller_tests COMMAND call_controller_tests)
