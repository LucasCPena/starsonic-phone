cmake_minimum_required(VERSION 3.16)
project(starsonic_tests CXX)

set(CMAKE_CXX_STANDARD 14)
set(CMAKE_CXX_STANDARD_REQUIRED ON)
set(CMAKE_CXX_EXTENSIONS OFF)

set(STARSONIC_DIR ${CMAKE_CURRENT_SOURCE_DIR}/../starsonic)

file(GLOB STARSONIC_CORE_SOURCES CONFIGURE_DEPENDS ${STARSONIC_DIR}/core/*.cpp)
file(GLOB STARSONIC_TEST_SOURCES CONFIGURE_DEPENDS ${CMAKE_CURRENT_SOURCE_DIR}/test_*.cpp)

add_executable(starsonic_tests main.cpp ${STARSONIC_TEST_SOURCES} ${STARSONIC_CORE_SOURCES})
target_include_directories(starsonic_tests PRIVATE
  ${STARSONIC_DIR}/core
  ${STARSONIC_DIR}/third_party
  ${CMAKE_CURRENT_SOURCE_DIR})
target_compile_definitions(starsonic_tests PRIVATE
  STARSONIC_REPO_DIR="${CMAKE_CURRENT_SOURCE_DIR}/..")

if(MSVC)
  target_compile_options(starsonic_tests PRIVATE /W4 /EHsc)
else()
  target_compile_options(starsonic_tests PRIVATE -Wall -Wextra)
endif()

if(WIN32)
  # Testes que dependem de APIs do Windows (so os arquivos Win32 puros de starsonic/win, sem MFC).
  target_sources(starsonic_tests PRIVATE
    ${STARSONIC_DIR}/win/Sha256.cpp
    ${CMAKE_CURRENT_SOURCE_DIR}/win/test_sha256.cpp)
  target_include_directories(starsonic_tests PRIVATE ${STARSONIC_DIR}/win)
  target_link_libraries(starsonic_tests PRIVATE bcrypt)
endif()

enable_testing()
add_test(NAME starsonic_tests COMMAND starsonic_tests)

if(WIN32)
  # A senha da rc.7: o lado original do teste precisa do MFC, num executavel proprio (win/legacy_crypto).
  add_subdirectory(win/legacy_crypto)
endif()
