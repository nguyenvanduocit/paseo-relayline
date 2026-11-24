"""Relay a Paseo Claude stream and inject acknowledged OAuth updates on a private socket."""

import json
import os
import re
import signal
import socket
import subprocess
import sys
import threading
import uuid

command = sys.argv[1:]
env = os.environ.copy()
directory = env.pop("RELAYLINE_LIVE_DIR", "")
if not re.fullmatch(r"/tmp/relayline-[a-f0-9]{32}", directory) or "--input-format" not in command or "stream-json" not in command:
    os.execvpe(command[0], command, env)

path = os.path.join(directory, "control.sock")
listener = socket.socket(socket.AF_UNIX)
try:
    os.mkdir(directory, mode=0o700)
    try:
        listener.bind(path)
        listener.listen(4)
    except BaseException:
        os.rmdir(directory)
        raise
except OSError:
    listener.close()
    os.execvpe(command[0], command, env)

try:
    child = subprocess.Popen(command, env=env, stdin=subprocess.PIPE, stdout=subprocess.PIPE, bufsize=-1)
    input_lock = threading.Lock()
    responses = {}
    responses_lock = threading.Lock()
    response_prefix = "relayline-" + uuid.uuid4().hex + "-"

    def forward_signal(signum, _frame):
        if child.poll() is None:
            child.send_signal(signum)

    for signum in (signal.SIGTERM, signal.SIGINT, signal.SIGHUP):
        signal.signal(signum, forward_signal)

    def write(line):
        with input_lock:
            child.stdin.write(line)
            child.stdin.flush()

    def forward_input():
        try:
            for line in sys.stdin.buffer:
                write(line)
        except (BrokenPipeError, ValueError):
            pass
        finally:
            with input_lock:
                child.stdin.close()

    def serve():
        while True:
            try:
                connection, _ = listener.accept()
            except OSError:
                return
            with connection:
                connection.settimeout(3)
                try:
                    with connection.makefile("rb") as stream:
                        request = json.loads(stream.readline(16_384))
                    token = request.get("token")
                    if not isinstance(token, str) or not re.fullmatch(r"sk-ant-oat[A-Za-z0-9_-]+", token):
                        continue
                    request_id = response_prefix + uuid.uuid4().hex
                    done = threading.Event()
                    reply = {"ok": False}
                    with responses_lock:
                        responses[request_id] = (done, reply)
                    try:
                        frame = {
                            "type": "update_environment_variables",
                            "request_id": request_id,
                            "variables": {"CLAUDE_CODE_OAUTH_TOKEN": token},
                        }
                        write(json.dumps(frame).encode() + b"\n")
                        done.wait(timeout=4)
                        if reply["ok"]:
                            reply["pid"] = child.pid
                        connection.sendall(json.dumps(reply).encode() + b"\n")
                    finally:
                        with responses_lock:
                            responses.pop(request_id, None)
                except (OSError, ValueError, TypeError, AttributeError):
                    # No request or response body reaches stderr or the SDK stream.
                    continue

    threading.Thread(target=forward_input, daemon=True).start()
    threading.Thread(target=serve, daemon=True).start()
    for line in child.stdout:
        if b'"control_response"' in line and response_prefix.encode() in line:
            try:
                response = json.loads(line).get("response", {})
                request_id = response.get("request_id", "")
                if request_id.startswith(response_prefix):
                    with responses_lock:
                        pending = responses.get(request_id)
                        if pending:
                            done, reply = pending
                            reply["ok"] = response.get("subtype") == "success"
                            done.set()
                    continue
            except (ValueError, AttributeError):
                pass
        sys.stdout.buffer.write(line)
        sys.stdout.buffer.flush()
    result = child.wait()
finally:
    listener.close()
    os.unlink(path)
    os.rmdir(directory)

sys.exit(result if result >= 0 else 128 - result)
