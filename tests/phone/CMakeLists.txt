cmake_minimum_required(VERSION 3.16)
project(starsonic_phone_tests CXX)

set(CMAKE_CXX_STANDARD 14)
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

enable_testing()
add_test(NAME phone_tests COMMAND phone_tests)
