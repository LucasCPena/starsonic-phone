#pragma once
// Apoio aos testes: deixa o doctest mostrar std::wstring nas mensagens de falha.
#include <string>
#include <vector>
#include <cstdio>
#include "doctest/doctest.h"

namespace doctest {
template <>
struct StringMaker<std::wstring> {
    static String convert(const std::wstring& text) {
        std::string out = "L\"";
        for (wchar_t ch : text) {
            unsigned long code = static_cast<unsigned long>(ch);
            if (code >= 0x20 && code < 0x7F) {
                out += static_cast<char>(code);
            } else {
                char buffer[16];
                std::snprintf(buffer, sizeof(buffer), "\\u%04lx", code);
                out += buffer;
            }
        }
        out += "\"";
        return String(out.c_str());
    }
};

template <>
struct StringMaker<std::vector<std::wstring>> {
    static String convert(const std::vector<std::wstring>& items) {
        std::string out = "{";
        for (size_t i = 0; i < items.size(); ++i) {
            if (i) out += ", ";
            out += StringMaker<std::wstring>::convert(items[i]).c_str();
        }
        out += "}";
        return String(out.c_str());
    }
};

template <>
struct StringMaker<std::vector<std::string>> {
    static String convert(const std::vector<std::string>& items) {
        std::string out = "{";
        for (size_t i = 0; i < items.size(); ++i) {
            if (i) out += ", ";
            out += "\"" + items[i] + "\"";
        }
        out += "}";
        return String(out.c_str());
    }
};
}  // namespace doctest
