#pragma once
// SHA-256 pelo BCrypt do Windows.
#include <string>

// Hexadecimal minusculo (64 caracteres); vazio se o BCrypt falhar.
std::string Sha256Hex(const std::string& bytes);
