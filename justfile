set shell := ["nu", "-c"]
set script-interpreter := ["nu"]
set unstable

[doc('Build the @yrrrrrf/dv package via pipeline')]
[group('deploy')]
build:
    deno run -A scripts/pipeline.ts build

[working-directory('build')]
[private]
[script]
_with-brave +cmd:
    let d = (mktemp -d)
    "#!/usr/bin/env nu\ndef main [...args] { exec brave ...$args }" | save -f $"($d)/xdg-open"
    chmod +x $"($d)/xdg-open"
    with-env { PATH: ($env.PATH | prepend $d) } { {{ cmd }} }
    print "✓ {{ cmd }} done"

[doc('Publish build/ to npm')]
[group('deploy')]
publish: build (_with-brave "bun publish")

[doc('npm login')]
[group('deploy')]
login: (_with-brave "bunx npm login")


