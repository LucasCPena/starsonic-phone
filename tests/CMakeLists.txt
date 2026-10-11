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
  # Testes que dependem de APIs do Windows (Task 14).
endif()

enable_testing()
add_test(NAME starsonic_tests COMMAND starsonic_tests)
