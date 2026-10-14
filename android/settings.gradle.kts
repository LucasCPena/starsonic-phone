// App Android do Starsonic Phone (etapa 1). Sem o wrapper do Gradle: a versão vem de build/deps.lock
// (chave android.gradle), e o CI a instala com gradle/actions/setup-gradle.
pluginManagement {
    repositories {
        google()
        mavenCentral()
        gradlePluginPortal()
    }
}

dependencyResolutionManagement {
    repositoriesMode.set(RepositoriesMode.FAIL_ON_PROJECT_REPOS)
    repositories {
        google()
        mavenCentral()
    }
}

rootProject.name = "StarsonicPhone"
include(":app")
