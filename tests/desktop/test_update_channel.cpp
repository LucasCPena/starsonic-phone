// O canal de atualizacao que vale no executavel (windows/app/src/UpdateChannel.h, rc.3 Ruling 4): o do administrador
// (o gancho updateChannel do DesktopApp) ou o do build. C++ portatil.
#include "UpdateChannel.h"
#include "test_support.h"

using namespace starsonic;

TEST_CASE("the update channel follows the admin choice and falls back to the build channel") {
    UpdateChannel testBuild(/*buildTest=*/true);
    CHECK(testBuild.Test());   // antes do gancho: o do build
    testBuild.Set("estavel");
    CHECK_FALSE(testBuild.Test());
    testBuild.Set("teste");
    CHECK(testBuild.Test());
    testBuild.Set("estavel");
    testBuild.Set("");   // "" e o do build de novo
    CHECK(testBuild.Test());

    UpdateChannel stableBuild(/*buildTest=*/false);
    CHECK_FALSE(stableBuild.Test());
    stableBuild.Set("teste");
    CHECK(stableBuild.Test());
    stableBuild.Set("");
    CHECK_FALSE(stableBuild.Test());
    // Um canal que nao existe (o DesktopApp nunca manda): o do build.
    stableBuild.Set("teste");
    stableBuild.Set("beta");
    CHECK_FALSE(stableBuild.Test());
}
