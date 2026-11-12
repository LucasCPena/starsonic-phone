#pragma once
// Os ajudantes dos testes do controlador de ligações (test_call_controller.cpp e test_call_controller_room.cpp): as
// listas e os pares nas mensagens do doctest, os textos em UTF-8, a ligação e o estado como a tela os vê, e os
// Recentes. Os falsos (o motor, o ouvinte, o relógio e os contatos) e as impressões dos tipos do controlador estão no
// fake_call_engine.h.
#include <cstdint>
#include <sstream>
#include <string>
#include <utility>
#include <vector>

#include "CallController.h"
#include "Text.h"
#include "doctest/doctest.h"

namespace doctest {

// As listas e os pares nas mensagens do doctest quando uma comparação falha.
template <typename T>
struct StringMaker<std::vector<T>> {
    static String convert(const std::vector<T>& values) {
        std::ostringstream out;
        out << "[";
        for (size_t i = 0; i < values.size(); ++i) out << (i ? ", " : "") << toString(values[i]).c_str();
        out << "]";
        return out.str().c_str();
    }
};

template <typename A, typename B>
struct StringMaker<std::pair<A, B>> {
    static String convert(const std::pair<A, B>& value) {
        std::ostringstream out;
        out << "(" << toString(value.first).c_str() << ", " << toString(value.second).c_str() << ")";
        return out.str().c_str();
    }
};

}  // namespace doctest

namespace phone_test {

// Os textos em pt-BR, em UTF-8 (os literais do C++ ficam em ASCII: build/check_source_text.py).
inline std::string U8(const std::wstring& text) { return starsonic::WideToUtf8(text); }

// Uma ligação como a tela a vê (o vídeo fica o de sempre: nenhum).
inline starsonic::CallView View(int id, const std::string& number, const std::string& name, bool incoming,
                                starsonic::CallView::Phase phase, int64_t activeSinceMs = 0, bool held = false) {
    starsonic::CallView view;
    view.id = id;
    view.number = number;
    view.name = name;
    view.incoming = incoming;
    view.phase = phase;
    view.activeSinceMs = activeSinceMs;
    view.held = held;
    return view;
}

inline starsonic::Recent MakeRecent(const std::string& number, const std::string& name, starsonic::Recent::Kind kind,
                                    int64_t startMs, int64_t durationMs) {
    starsonic::Recent recent;
    recent.number = number;
    recent.name = name;
    recent.kind = kind;
    recent.startMs = startMs;
    recent.durationMs = durationMs;
    return recent;
}

// O que a tela mostra com uma ligação só (top).
inline starsonic::CallSnapshot One(const starsonic::CallView& top) {
    starsonic::CallSnapshot snapshot;
    snapshot.top = top;
    return snapshot;
}

// A mesma ligação, em espera.
inline starsonic::CallView Held(starsonic::CallView view) {
    view.held = true;
    return view;
}

}  // namespace phone_test
