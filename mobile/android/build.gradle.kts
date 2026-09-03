allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

val newBuildDir: Directory =
    rootProject.layout.buildDirectory
        .dir("../../build")
        .get()
rootProject.layout.buildDirectory.value(newBuildDir)

subprojects {
    val newSubprojectBuildDir: Directory = newBuildDir.dir(project.name)
    project.layout.buildDirectory.value(newSubprojectBuildDir)
}
// file_picker + friends now require compileSdk 36. Bump every Flutter
// plugin subproject to match. `withGroovyBuilder` bypasses the strict
// Kotlin-DSL type checking that made reflection unreliable across the
// LibraryExtension / BaseExtension variants Flutter plugins ship with.
subprojects {
    afterEvaluate {
        val android = extensions.findByName("android") ?: return@afterEvaluate
        try {
            (android as groovy.lang.GroovyObject)
                .setProperty("compileSdkVersion", 36)
        } catch (_: Throwable) {
            try {
                // Some older AGPs prefer the "android-XX" string form.
                (android as groovy.lang.GroovyObject)
                    .setProperty("compileSdkVersion", "android-36")
            } catch (_: Throwable) {
                // Non-android subproject or exotic AGP — leave alone.
            }
        }
    }
}

subprojects {
    project.evaluationDependsOn(":app")
}

tasks.register<Delete>("clean") {
    delete(rootProject.layout.buildDirectory)
}
