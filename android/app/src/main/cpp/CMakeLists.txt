# libstarsonic.so: o núcleo (starsonic/core), o motor de ligações (starsonic/phone) e a ponte JNI,
# ligados ao PJSIP, ao Opus e ao Oboe compilados por build/android/build-deps.sh (artefato android-deps).
# O Gradle passa -DANDROID_STL=c++_shared e -DSTARSONIC_ANDROID_DEPS=<android-deps> (app/build.gradle.kts).
cmake_minimum_required(VERSION 3.22.1)
project(starsonic LANGUAGES CXX)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

if(NOT STARSONIC_ANDROID_DEPS)
  message(FATAL_ERROR "Informe -DSTARSONIC_ANDROID_DEPS=<pasta android-deps> (no Gradle: -Pstarsonic.deps=<pasta>)")
endif()
set(DEPS "${STARSONIC_ANDROID_DEPS}/${ANDROID_ABI}")
if(NOT EXISTS "${DEPS}/include/pjsua2.hpp" OR NOT EXISTS "${DEPS}/pjproject.cflags")
  message(FATAL_ERROR "Sem o PJSIP de ${ANDROID_ABI} em ${DEPS} (build/android/build-deps.sh)")
endif()

get_filename_component(REPO "${CMAKE_CURRENT_SOURCE_DIR}/../../../../.." ABSOLUTE)
file(GLOB CORE_SOURCES CONFIGURE_DEPENDS "${REPO}/starsonic/core/*.cpp")
file(GLOB PHONE_SOURCES CONFIGURE_DEPENDS "${REPO}/starsonic/phone/*.cpp")
if(NOT CORE_SOURCES OR NOT PHONE_SOURCES)
  message(FATAL_ERROR "Sem os fontes de ${REPO}/starsonic/core e ${REPO}/starsonic/phone")
endif()

add_library(starsonic SHARED jni_bridge.cpp ${CORE_SOURCES} ${PHONE_SOURCES})
target_include_directories(starsonic PRIVATE "${REPO}/starsonic/core" "${REPO}/starsonic/phone")
target_include_directories(starsonic SYSTEM PRIVATE "${REPO}/starsonic/third_party" "${DEPS}/include")
target_compile_options(starsonic PRIVATE -Wall -Wextra -fexceptions -frtti)

# Do pjproject.cflags só valem os -D: o -I aponta para a pasta do runner que compilou o android-deps.
# O PJ_DEBUG não entra aqui: o config_site.h instalado já o fixa em 0, igual ao das bibliotecas.
file(READ "${DEPS}/pjproject.cflags" PJ_CFLAGS)
separate_arguments(PJ_DEFINES UNIX_COMMAND "${PJ_CFLAGS}")
list(FILTER PJ_DEFINES INCLUDE REGEX "^-D.")
if(NOT PJ_DEFINES)
  message(FATAL_ERROR "Sem nenhum -D em ${DEPS}/pjproject.cflags: ${PJ_CFLAGS}")
endif()
list(TRANSFORM PJ_DEFINES REPLACE "^-D" "")
target_compile_definitions(starsonic PRIVATE ${PJ_DEFINES})

# Fora da biblioteca só ficam JNI_OnLoad e as funções Java_* (JNIEXPORT): nada dos nomes internos do
# núcleo, do motor, do PJSIP e do Opus. A visibilidade oculta vale para o nosso código; o roteiro de
# versões (starsonic.map) também esconde o que vem das bibliotecas estáticas e as instâncias de modelos
# da biblioteca padrão que os cabeçalhos dela marcam como visíveis.
set_target_properties(starsonic PROPERTIES
  CXX_VISIBILITY_PRESET hidden
  VISIBILITY_INLINES_HIDDEN ON
  LINK_DEPENDS "${CMAKE_CURRENT_SOURCE_DIR}/starsonic.map")

# As bibliotecas do pjproject, na ordem do libpjproject.pc; o nome de cada uma leva o triplo da ABI
# (libpjsua2-aarch64-unknown-linux-android.a etc.).
file(GLOB PJSUA2 "${DEPS}/lib/libpjsua2-*.a")
list(LENGTH PJSUA2 PJSUA2_COUNT)
if(NOT PJSUA2_COUNT EQUAL 1)
  message(FATAL_ERROR "Esperava um libpjsua2-*.a em ${DEPS}/lib: ${PJSUA2}")
endif()
string(REGEX REPLACE "^.*/libpjsua2-(.+)\\.a$" "\\1" TRIPLE "${PJSUA2}")
set(PJ_ARCHIVES)
foreach(NAME pjsua2 pjsua pjsip-ua pjsip-simple pjsip pjmedia-codec pjmedia-videodev pjmedia-audiodev pjmedia
             pjnath pjlib-util pj srtp resample speex webrtc)
  set(ARCHIVE "${DEPS}/lib/lib${NAME}-${TRIPLE}.a")
  if(NOT EXISTS "${ARCHIVE}")
    message(FATAL_ERROR "Falta ${ARCHIVE}")
  endif()
  list(APPEND PJ_ARCHIVES "${ARCHIVE}")
endforeach()
list(APPEND PJ_ARCHIVES "${DEPS}/lib/libopus.a")

# O Oboe vem do AAR com.google.oboe:oboe (prefab), o mesmo com que o android-deps foi compilado.
find_package(oboe REQUIRED CONFIG)

target_link_libraries(starsonic PRIVATE
  -Wl,--start-group ${PJ_ARCHIVES} -Wl,--end-group
  oboe::oboe OpenSLES log android)
target_link_options(starsonic PRIVATE
  "-Wl,--version-script=${CMAKE_CURRENT_SOURCE_DIR}/starsonic.map"
  # Segmentos alinhados a 16 KB (Android 15+), também no armeabi-v7a.
  "-Wl,-z,max-page-size=16384")
