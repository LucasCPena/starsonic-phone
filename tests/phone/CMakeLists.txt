cmake_minimum_required(VERSION 3.16)
project(starsonic_phone_tests CXX)

set(CMAKE_CXX_STANDARD 17)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

# Os motores de ligações dos testes, um ou os dois:
#   cmake -S tests/phone -B <build> -DPJPROJECT_PREFIX=<prefixo do make install>  (build/linux/build-pjproject.sh)
#   cmake -S tests/phone -B <build> -DBARESIP_PREFIX=<PREFIX do build-linux.sh>   (build/baresip/build-linux.sh)
# O phone_tests usa o motor do PJSIP; o phone_tests_baresip, o do baresip; o call_controller_tests, nenhum.
if(NOT PJPROJECT_PREFIX AND NOT BARESIP_PREFIX)
  message(FATAL_ERROR "Informe -DPJPROJECT_PREFIX=<prefixo do pjproject> (veja build/linux/build-pjproject.sh), "
                      "-DBARESIP_PREFIX=<prefixo do baresip> (veja build/baresip/build-linux.sh) ou os dois")
endif()

set(STARSONIC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../../starsonic)

file(GLOB STARSONIC_CORE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/core/*.cpp)
file(GLOB CALL_CONTROLLER_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/test_call_controller*.cpp)

# Os includes e o caminho do repositório dos testes dos dois motores.
set(ENGINE_TEST_INCLUDES
  ${STARSONIC_DIR}/core
  ${STARSONIC_DIR}/phone
  ${STARSONIC_DIR}/third_party
  ${CMAKE_CURRENT_SOURCE_DIR}/..)
set(ENGINE_TEST_DEFINITIONS STARSONIC_REPO_DIR="${CMAKE_CURRENT_SOURCE_DIR}/../..")

enable_testing()

if(PJPROJECT_PREFIX)
  get_filename_component(PJPROJECT_PREFIX "${PJPROJECT_PREFIX}" ABSOLUTE)
  set(ENV{PKG_CONFIG_PATH} "${PJPROJECT_PREFIX}/lib/pkgconfig:$ENV{PKG_CONFIG_PATH}")

  find_package(PkgConfig REQUIRED)
  pkg_check_modules(PJ REQUIRED IMPORTED_TARGET libpjproject)

  file(GLOB STARSONIC_PHONE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/phone/*.cpp)
  file(GLOB PHONE_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/*.cpp)
  # Os testes do controlador de ligações (call_controller_main.cpp e test_call_controller*.cpp) vão no
  # call_controller_tests, abaixo, e os só do motor com o baresip (test_engine_baresip.cpp), no phone_tests_baresip.
  list(FILTER PHONE_TEST_SOURCES EXCLUDE REGEX
       "/(call_controller_main|test_call_controller[^/]*|test_engine_baresip)\\.cpp$")
  if(NOT STARSONIC_PHONE_SOURCES)
    message(FATAL_ERROR "Sem fontes em ${STARSONIC_DIR}/phone")
  endif()

  add_executable(phone_tests ${PHONE_TEST_SOURCES} ${STARSONIC_CORE_SOURCES} ${STARSONIC_PHONE_SOURCES})
  target_include_directories(phone_tests PRIVATE ${ENGINE_TEST_INCLUDES})
  target_compile_definitions(phone_tests PRIVATE ${ENGINE_TEST_DEFINITIONS})
  target_compile_options(phone_tests PRIVATE -Wall -Wextra)
  # O libpjproject.pc põe speex, srtp, resample e uuid só em Libs.private; as bibliotecas do PJSIP são
  # estáticas, então o link precisa da lista completa (pkg-config --static).
  target_link_libraries(phone_tests PRIVATE PkgConfig::PJ ${PJ_STATIC_LDFLAGS})
  add_test(NAME phone_tests COMMAND phone_tests)
endif()

if(BARESIP_PREFIX)
  get_filename_component(BARESIP_PREFIX "${BARESIP_PREFIX}" ABSOLUTE)
  if(NOT EXISTS ${BARESIP_PREFIX}/lib/libstarsonic-baresip.a OR
     NOT EXISTS ${BARESIP_PREFIX}/lib/starsonic-baresip-libs.txt)
    message(FATAL_ERROR "${BARESIP_PREFIX} não tem o baresip (rode build/baresip/build-linux.sh WORKDIR PREFIX)")
  endif()

  # Os testes do motor com o baresip, um arquivo por assunto: os do contrato entram à medida que o motor os cumpre; os
  # que só valem para o PJSIP (test_engine_pjsip.cpp, test_engine_audio.cpp e test_engine_blf.cpp) nunca entram.
  set(BARESIP_TEST_SOURCES
    main.cpp
    test_engine_setup.cpp
    test_engine_register.cpp
    test_engine_network.cpp
    test_engine_calls.cpp
    test_engine_hold.cpp
    test_engine_transfer.cpp
    test_engine_baresip.cpp
    test_push_data.cpp
    test_account_config.cpp)
  list(TRANSFORM BARESIP_TEST_SOURCES PREPEND ${CMAKE_CURRENT_SOURCE_DIR}/)
  file(GLOB STARSONIC_BARESIP_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/phone/baresip/*.cpp)

  add_executable(phone_tests_baresip
    ${BARESIP_TEST_SOURCES}
    ${STARSONIC_CORE_SOURCES}
    ${STARSONIC_DIR}/phone/CallController.cpp
    ${STARSONIC_DIR}/phone/CallEngine.cpp
    ${STARSONIC_DIR}/phone/EngineEvents.cpp
    ${STARSONIC_DIR}/phone/AccountConfig.cpp
    ${STARSONIC_DIR}/phone/PushDataCheck.cpp
    ${STARSONIC_BARESIP_SOURCES})
  target_include_directories(phone_tests_baresip PRIVATE
    ${ENGINE_TEST_INCLUDES}
    ${STARSONIC_DIR}/phone/baresip
    ${BARESIP_PREFIX}/include
    ${BARESIP_PREFIX}/include/re)
  target_compile_definitions(phone_tests_baresip PRIVATE ${ENGINE_TEST_DEFINITIONS})
  target_compile_options(phone_tests_baresip PRIVATE -Wall -Wextra)
  # O baresip (com os módulos), a libre e a libg722 chamam funções umas das outras: entre o --start-group e o
  # --end-group a ordem não importa. As bibliotecas do sistema são as que o build-linux.sh escreveu.
  file(STRINGS ${BARESIP_PREFIX}/lib/starsonic-baresip-libs.txt BARESIP_SYSTEM_LIBS_TEXT)
  separate_arguments(BARESIP_SYSTEM_LIBS UNIX_COMMAND "${BARESIP_SYSTEM_LIBS_TEXT}")
  target_link_libraries(phone_tests_baresip PRIVATE
    -Wl,--start-group
    ${BARESIP_PREFIX}/lib/libstarsonic-baresip.a
    ${BARESIP_PREFIX}/lib/libre.a
    ${BARESIP_PREFIX}/lib/libg722.a
    -Wl,--end-group
    ${BARESIP_SYSTEM_LIBS})
  add_test(NAME phone_tests_baresip COMMAND phone_tests_baresip)
endif()

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
add_test(NAME call_controller_tests COMMAND call_controller_tests)
