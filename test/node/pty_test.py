"""Exercise prompt cancellation, reuse, and raw-mode restoration on a real PTY."""
import json
import os
import pathlib
import pty
import select
import subprocess
import termios
import time


def exercise(command, cwd):
    master, slave = pty.openpty()
    original = termios.tcgetattr(slave)
    env = dict(os.environ, TERM="xterm-256color")
    code = """
      const {choose} = await import('@yrrrrrf/dv');
      const options = [{value:'a',label:'alpha'},{value:'b',label:'beta'}];
      for (let i=0;i<3;i++) {
        try { console.log('ANSWER:'+await choose('Pick'+i,options)); }
        catch(e) { console.log('CANCEL:'+e.message); }
      }
    """
    fixture = pathlib.Path(cwd) / "prompt-fixture.mjs"
    fixture.write_text(code)
    child = subprocess.Popen(command + [str(fixture)], cwd=cwd, env=env,
                             stdin=slave, stdout=slave, stderr=slave)
    output = bytearray()
    deadline = time.monotonic() + 15

    def wait_for(marker):
        while marker not in output:
            if time.monotonic() >= deadline:
                raise AssertionError(f"PTY timeout: {output!r}")
            ready, _, _ = select.select([master], [], [], 0.2)
            if ready:
                output.extend(os.read(master, 65536))

    try:
        wait_for(b"Pick0")
        os.write(master, b"\x03")
        wait_for(b"CANCEL:Selection cancelled")
        wait_for(b"Pick1")
        os.write(master, b"beta\r")
        wait_for(b"ANSWER:b")
        wait_for(b"Pick2")
        os.write(master, b"\x1b[B\r")
        wait_for(b"ANSWER:b")
        child.wait(timeout=max(1, deadline - time.monotonic()))
        assert child.returncode == 0, output
        restored = termios.tcgetattr(slave)
        mask = termios.ICANON | termios.ECHO | termios.ISIG
        assert original[3] & mask == restored[3] & mask, "Raw mode was not restored"
    finally:
        if child.poll() is None:
            child.kill()
            child.wait()
        os.close(master)
        os.close(slave)
        fixture.unlink(missing_ok=True)


if __name__ == "__main__":
    exercise([os.environ.get("DV_TEST_NODE", "node")], os.getcwd())
    print(json.dumps({"pty": "passed"}))
