"""Native POSIX terminal tests. Run with DV_TEST_DENO and DV_TEST_JUST set.

Uses only Python's standard library; the ordinary Deno suite is independent.
"""

import errno
import fcntl
import json
import os
from pathlib import Path
import pty
import select
import signal
import shutil
import struct
import subprocess
import tempfile
import termios
import time
import unittest

ROOT = Path(__file__).resolve().parents[1]
DENO = os.environ.get("DV_TEST_DENO") or shutil.which("deno")
JUST = os.environ.get("DV_TEST_JUST") or shutil.which("just")


def terminal(argv, steps=(), env=None, columns=110, rows=32):
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", rows, columns, 0, 0))
    settings = {**os.environ, "TERM": "xterm-256color", **(env or {})}
    settings.pop("NO_COLOR", None)
    settings.pop("FORCE_COLOR", None)
    proc = subprocess.Popen(argv, stdin=slave, stdout=slave, stderr=slave, env=settings)
    output = bytearray()
    deadline = time.monotonic() + 12
    cursor = 0

    def receive():
        if select.select([master], [], [], 0.05)[0]:
            try:
                part = os.read(master, 65536)
            except OSError as error:
                if error.errno != errno.EIO:
                    raise
                return False
            output.extend(part)
            return bool(part)
        return proc.poll() is None

    try:
        for marker, keys in steps:
            marker = marker.encode()
            while output.find(marker, cursor) < 0:
                if time.monotonic() > deadline or not receive():
                    raise AssertionError(f"Missing prompt {marker!r}: {bytes(output)[-2000:]!r}")
            cursor = output.find(marker, cursor) + len(marker)
            if isinstance(keys, int):
                proc.send_signal(keys)
            else:
                os.write(master, keys)
        while proc.poll() is None:
            if time.monotonic() > deadline:
                raise AssertionError(f"Terminal process hung: {bytes(output)[-2000:]!r}")
            receive()
        # The slave remains open for terminal-mode inspection; drain queued data.
        while select.select([master], [], [], 0.05)[0]:
            output.extend(os.read(master, 65536))
        restored = termios.tcgetattr(slave)
        if restored[3] & (termios.ICANON | termios.ECHO) != original[3] & (termios.ICANON | termios.ECHO):
            raise AssertionError("Menu did not restore canonical input/echo")
        return proc.returncode, bytes(output)
    finally:
        if proc.poll() is None:
            proc.kill()
            proc.wait()
        os.close(master)
        os.close(slave)


@unittest.skipUnless(DENO, "Deno is required")
class MenuTerminalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="dv-menu-")
        self.addCleanup(self.temp.cleanup)
        self.directory = Path(self.temp.name)
        self.record = self.directory / "record.json"
        self.env = {"DV_RECORD": str(self.record)}
        self.workspace = self.directory / "workspace.ts"
        self.workspace.write_text(
            'import {createPipeline} from ' + json.dumps((ROOT / "src/mod.ts").as_uri()) + ';\n'
            'const workspace=createPipeline({\n'
            ' test:{group:"test",description:"Test every app",complete:()=>["alpha","beta"],'
            'run:({options})=>Deno.writeTextFile(Deno.env.get("DV_RECORD")!,JSON.stringify('
            '{target:options.target??null,all:options.all??false,verbose:options.verbose??false}))},\n'
            ' fail:{group:"check",run:({exec})=>exec(["deno","eval","Deno.exit(7)"])}\n'
            '}); Deno.exit(await workspace.cli());\n'
        )

    def workspace_command(self, *args):
        return [DENO, "run", "-A", str(self.workspace), *args]

    def test_typescript_menu_without_justfile(self):
        code, _ = terminal(self.workspace_command("test"), env=self.env)
        self.assertEqual(code, 0)
        direct = json.loads(self.record.read_text())
        code, output = terminal(self.workspace_command("menu"), [
            ("Recipe ›", b"test\r"), ("Options ›", b"\r"), ("Target ›", b"\r"),
        ], self.env)
        self.assertEqual(code, 0, output)
        self.assertEqual(json.loads(self.record.read_text()), direct)
        self.assertIn(b"\x1b[2;3m", output)
        self.assertIn(b"[test]", output)

    def test_explicit_target_and_options(self):
        code, output = terminal(self.workspace_command("menu", "beta"), [
            ("Recipe ›", b"test\r"), ("Options ›", b"--verbose\r"),
        ], self.env)
        self.assertEqual(code, 0, output)
        self.assertNotIn("Target ›".encode(), output)
        self.assertEqual(json.loads(self.record.read_text()), {"target": "beta", "all": False, "verbose": True})

    def test_failures_and_cancel(self):
        code, output = terminal(self.workspace_command("menu"), [
            ("Recipe ›", b"fail\r"), ("Options ›", b"\r"),
        ], self.env)
        self.assertEqual(code, 7, output)
        code, _ = terminal(self.workspace_command("menu"), [("Recipe ›", b"\x03")], self.env)
        self.assertEqual(code, 130)
        code, _ = terminal(self.workspace_command("menu"), [("Recipe ›", b"\x1b")], self.env)
        self.assertEqual(code, 130)
        code, _ = terminal(self.workspace_command("menu"), [("Recipe ›", signal.SIGTERM)], self.env)
        self.assertEqual(code, 130)

    @unittest.skipUnless(JUST, "Just is required")
    def test_just_argv_defaults_tty_colors_and_failure(self):
        child = self.directory / "child.ts"
        child.write_text(
            'Deno.writeTextFileSync(Deno.env.get("DV_RECORD")!, JSON.stringify({args:Deno.args,'
            'tty:[Deno.stdin.isTerminal(),Deno.stdout.isTerminal(),Deno.stderr.isTerminal()]}));'
            'console.log("\\x1b[32mCHILD_GREEN\\x1b[0m");'
            'if(Deno.args[0]==="interactive"){Deno.stdin.setRaw(true);try{'
            'console.log("NATIVE_READY");const b=new Uint8Array(1);await Deno.stdin.read(b);'
            'console.log("KEY="+new TextDecoder().decode(b));}finally{Deno.stdin.setRaw(false);}}'

        )
        justfile = self.directory / "justfile"
        justfile.write_text(
            'set positional-arguments\nset script-interpreter := ["sh"]\n'
            '[group("test")]\n[script]\ntest value="original" *args:\n'
            f'    exec "{DENO}" run -A "{child}" "$@"\n'
            '[script]\nfail:\n    exit 42\n'
        )
        # The optional adapter intentionally resolves the normal `just` executable.
        env = {**self.env, "PATH": str(Path(JUST).parent) + os.pathsep + os.environ["PATH"]}
        menu = [DENO, "run", "-A", str(ROOT / "src/mod.ts"), "menu", "--justfile", str(justfile)]
        for arguments, entered in [([], b"\r"), (["{root}", "space value", ""], b"'{root}' 'space value' ''\r")]:
            code, output = terminal([JUST, "--justfile", str(justfile), "test", *arguments], env=env)
            self.assertEqual(code, 0, output)
            direct = json.loads(self.record.read_text())
            code, output = terminal(menu, [("Recipe ›", b"test\r"), ("Arguments ›", entered)], env)
            self.assertEqual(code, 0, output)
            self.assertEqual(json.loads(self.record.read_text()), direct)
            self.assertEqual(direct["tty"], [True, True, True])
            self.assertIn(b"\x1b[32mCHILD_GREEN\x1b[0m", output)
        code, output = terminal(menu, [("Recipe ›", b"test\r"), ("Arguments ›", b"interactive\r"), ("NATIVE_READY", b"q")], env)
        self.assertEqual(code, 0, output)
        self.assertIn(b"KEY=q", output)
        code, output = terminal(menu, [("Recipe ›", b"fail\r")], env)
        self.assertEqual(code, 42, output)


if __name__ == "__main__":
    unittest.main(verbosity=2)
