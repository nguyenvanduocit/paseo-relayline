"""Run Claude's official setup-token command in a private pseudo-terminal."""

import errno
import fcntl
import os
import pty
import select
import signal
import struct
import subprocess
import sys
import termios

stopping = False


def stop(_signal, _frame):
    global stopping
    stopping = True


def run(claude, profile):
    master, slave = pty.openpty()
    try:
        fcntl.ioctl(slave, termios.TIOCSWINSZ, struct.pack("HHHH", 60, 640, 0, 0))
        env = {key: value for key, value in os.environ.items()
               if not key.startswith(("ANTHROPIC_", "CLAUDE_CODE_"))}
        env.update(
            TERM="xterm-256color",
            BROWSER="/usr/bin/false",
            CLAUDE_CONFIG_DIR=profile,
            CLAUDE_SECURESTORAGE_CONFIG_DIR=profile,
            DISABLE_TELEMETRY="1",
        )
        child = subprocess.Popen(
            [claude, "setup-token"], stdin=slave, stdout=slave, stderr=slave,
            cwd=profile, env=env, start_new_session=True,
        )
    except BaseException:
        os.close(master)
        raise
    finally:
        os.close(slave)

    try:
        while not stopping:
            ready, _, _ = select.select([master, sys.stdin.fileno()], [], [], 0.25)
            if master in ready:
                try:
                    chunk = os.read(master, 32768)
                except OSError as error:
                    if error.errno != errno.EIO:
                        raise
                    break
                if not chunk:
                    break
                sys.stdout.buffer.write(chunk)
                sys.stdout.buffer.flush()
            if sys.stdin.fileno() in ready:
                chunk = os.read(sys.stdin.fileno(), 4096)
                if not chunk:
                    break
                view = memoryview(chunk)
                while view:
                    written = os.write(master, view)
                    view = view[written:]
            if not ready and child.poll() is not None:
                break

        if not stopping:
            try:
                return child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                pass
        return 1
    finally:
        os.close(master)
        if child.poll() is None:
            try:
                os.killpg(child.pid, signal.SIGTERM)
                child.wait(timeout=1)
            except subprocess.TimeoutExpired:
                os.killpg(child.pid, signal.SIGKILL)
                child.wait()
            except ProcessLookupError:
                child.wait()


for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
    signal.signal(signum, stop)

sys.exit(run(sys.argv[1], sys.argv[2]))
