"""Exercise the packed Node package in a native terminal using the existing harness."""
import json
import os
from pathlib import Path
import shutil
import signal
import sys
import unittest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from pty_menu_test import MenuTerminalTests, terminal, JUST

NODE = os.environ.get("DV_TEST_NODE") or shutil.which("node")
PACKAGE = os.environ.get("DV_TEST_PACKAGE_ROOT")
BIN = os.environ.get("DV_TEST_BIN")


@unittest.skipUnless(NODE and PACKAGE and BIN, "Packed Node package is required")
class NodeMenuTerminalTests(MenuTerminalTests):
    __unittest_skip__ = False

    def setUp(self):
        super().setUp()
        self.workspace = self.directory / "workspace.mjs"
        module = (Path(PACKAGE) / "esm/mod.js").as_uri()
        self.workspace.write_text(
            'import {createPipeline} from ' + json.dumps(module) + ';\n'
            'import {writeFile} from "node:fs/promises";\n'
            'const workspace=createPipeline({\n'
            ' test:{group:"test",description:"Test every app",complete:()=>["alpha","beta"],'
            'run:({options})=>writeFile(process.env.DV_RECORD,JSON.stringify('
            '{target:options.target??null,all:options.all??false,verbose:options.verbose??false}))},\n'
            ' fail:{group:"check",run:({exec})=>exec([process.execPath,"-e","process.exit(7)"])}\n'
            '}); process.exitCode=await workspace.cli();\n'
        )

    def workspace_command(self, *args):
        return [NODE, str(self.workspace), *args]

    @unittest.skipUnless(JUST, "Just is required")
    def test_just_argv_defaults_tty_colors_and_failure(self):
        child = self.directory / "child.mjs"
        child.write_text(
            'import{writeFileSync}from"node:fs";'
            'writeFileSync(process.env.DV_RECORD,JSON.stringify({args:process.argv.slice(2),'
            'tty:[process.stdin.isTTY===true,process.stdout.isTTY===true,process.stderr.isTTY===true]}));'
            'console.log("\\x1b[32mCHILD_GREEN\\x1b[0m");'
            'if(process.argv[2]==="interactive"){process.stdin.setRawMode(true);'
            'console.log("NATIVE_READY");const key=await new Promise(r=>process.stdin.once("data",r));'
            'console.log("KEY="+key);process.stdin.setRawMode(false);process.stdin.pause();process.stdin.unref();}'
        )
        justfile = self.directory / "justfile"
        justfile.write_text(
            'set positional-arguments\nset script-interpreter := ["sh"]\n'
            '[group("test")]\n[script]\ntest value="original" *args:\n'
            f'    exec "{NODE}" "{child}" "$@"\n'
            '[script]\nfail:\n    exit 42\n'
        )
        env = {**self.env, "PATH": str(Path(JUST).parent) + os.pathsep + os.environ["PATH"]}
        menu = [NODE, BIN, "menu", "--justfile", str(justfile)]
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

    def test_split_keys_and_bracketed_paste(self):
        code, output = terminal(self.workspace_command("menu"), [
            ("Recipe ›", b"\x1b[200~te\nst\x1b[201~\x15test\r"),
            ("Options ›", b"--verbose\r"),
            ("Target ›", b"beta\r"),
        ], self.env)
        self.assertEqual(code, 0, output)
        self.assertEqual(json.loads(self.record.read_text()), {"target": "beta", "all": False, "verbose": True})

    def test_cancelled_library_prompt_can_reopen(self):
        module = (Path(PACKAGE) / "esm/mod.js").as_uri()
        prompt = self.directory / "prompt.mjs"
        prompt.write_text(
            'import{choose}from ' + json.dumps(module) + ';'
            'const controller=new AbortController();'
            'const timer=setTimeout(()=>controller.abort(),250);'
            'try{await choose("First",[{value:"alpha",label:"alpha"}],{signal:controller.signal});}'
            'catch{console.log("CANCELLED");}finally{clearTimeout(timer);}'
            'console.log("RESULT="+await choose("Second",[{value:"beta",label:"beta"}]));'
        )
        code, output = terminal([NODE, str(prompt)], [
            ("First ›", b"\xe9"), ("Second ›", b"beta\r"),
        ], self.env)
        self.assertEqual(code, 0, output)
        self.assertIn(b"RESULT=beta", output)

    def test_raw_executor_inherits_keyboard_and_terminal_streams(self):
        child = self.directory / "raw.mjs"
        child.write_text(
            'console.log("TTY="+JSON.stringify([process.stdin.isTTY,process.stdout.isTTY,process.stderr.isTTY]));'
            'process.stdin.setRawMode(true);console.log("RAW_READY");'
            'const key=await new Promise(r=>process.stdin.once("data",r));'
            'process.stdin.setRawMode(false);process.stdin.pause();process.stdin.unref();console.log("KEY="+key);'
        )
        code, output = terminal([NODE, BIN, "exec", "--raw", "--", NODE, str(child)], [("RAW_READY", b"q")], self.env)
        self.assertEqual(code, 0, output)
        self.assertIn(b"TTY=[true,true,true]", output)
        self.assertIn(b"KEY=q", output)

    def test_raw_executor_normalizes_interrupt(self):
        code, output = terminal([
            NODE, BIN, "exec", "--raw", "--", NODE, "-e",
            'console.log("RAW_WAITING");setInterval(()=>{},1000)',
        ], [("RAW_WAITING", signal.SIGINT)], self.env)
        self.assertEqual(code, 0, output)


if __name__ == "__main__":
    unittest.main(defaultTest="NodeMenuTerminalTests", verbosity=2)
