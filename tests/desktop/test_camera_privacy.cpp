// A privacidade da camera do Windows (windows/app/src/CameraPrivacy.h): os tres valores do ConsentStore\webcam (o do
// computador, o do usuario e o dos apps da area de trabalho), e qualquer "Deny" nega a camera ao app. So a decisao
// (C++ portatil, roda tambem no Linux); a leitura do registro e do Windows.
#include "CameraPrivacy.h"
#include "test_support.h"

using namespace starsonic;

TEST_CASE("CameraConsentDenied is true when any value is Deny") {
    // Nada lido (os valores que faltam) ou tudo liberado: a camera nao esta negada.
    CHECK_FALSE(CameraConsentDenied("", "", ""));
    CHECK_FALSE(CameraConsentDenied("Allow", "Allow", "Allow"));
    CHECK_FALSE(CameraConsentDenied("Prompt", "", "Allow"));
    // Um "Deny" em qualquer um dos tres.
    CHECK(CameraConsentDenied("Deny", "Allow", "Allow"));
    CHECK(CameraConsentDenied("Allow", "Deny", "Allow"));
    CHECK(CameraConsentDenied("Allow", "Allow", "Deny"));
    CHECK(CameraConsentDenied("", "", "Deny"));
    CHECK(CameraConsentDenied("Deny", "Deny", "Deny"));
}
