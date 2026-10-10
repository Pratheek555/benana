# Playtester fixtures

Handwritten plugins for developing and checking the playtester without the builder agent. Owner: Track A.

`launch-sword`: a golden sword launches the mob it hits, with a 3 second cooldown.

```sh
mvn -q -f fixtures/launch-sword/pom.xml package                 # correct  -> target/LaunchSword.jar
mvn -q -f fixtures/launch-sword/pom.xml package -Dbugged=true   # bugged: knockback overwrites the launch
```

The bugged build is also the **labeled injected-bug fallback** for the demo recording.

`seeded`: the spec, test plan, and knockback-bugged source used by Mod Studio's **"Seeded bug (fallback)"** mode. It replaces the builder's first attempt, and the run is labeled as seeded in the UI. The playtester and fixer still run for real.
