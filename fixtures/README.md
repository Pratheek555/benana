# Playtester fixtures

Handwritten plugins for developing and checking the playtester without the builder agent. Owner: Track A.

`launch-sword`: a golden sword launches the mob it hits, with a 3 second cooldown.

```sh
mvn -q -f fixtures/launch-sword/pom.xml package                 # correct  -> target/LaunchSword.jar
mvn -q -f fixtures/launch-sword/pom.xml package -Dbugged=true   # bugged: knockback overwrites the launch
```

The bugged build is also the **labeled injected-bug fallback** for the demo recording.
