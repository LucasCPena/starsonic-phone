// O main do teste da senha da rc.7: inicia o MFC (o lado original do teste usa a DLL do MFC num programa de console)
// e roda o doctest. Sem cabecalhos do MFC aqui: o doctest inclui o windows.h do jeito dele.
#define DOCTEST_CONFIG_IMPLEMENT
#include "doctest/doctest.h"

bool StartMfc();   // test_legacy_crypto.cpp

int main(int argc, char** argv) {
    if (!StartMfc()) return 2;
    doctest::Context context(argc, argv);
    return context.run();
}
