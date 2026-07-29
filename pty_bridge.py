import os
import sys
import subprocess
import json
import threading

# Dynamic detection of Unix-specific PTY modules
try:
    import pty
    import termios
    import fcntl
    import struct
    import select
    HAS_PTY = True
except ImportError:
    HAS_PTY = False

def set_size_unix(fd, rows, cols):
    try:
        size = struct.pack('HHHH', rows, cols, 0, 0)
        fcntl.ioctl(fd, termios.TIOCSWINSZ, size)
    except Exception as e:
        sys.stderr.write(f"Resize failed: {e}\n")
        sys.stderr.flush()

def run_unix_pty():
    # Setup master/slave PTY
    master_fd, slave_fd = pty.openpty()
    
    # Start shell inside the PTY
    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"
    
    shell = "/bin/bash"
    if not os.path.exists(shell):
        shell = "/bin/sh"
        
    p = subprocess.Popen(
        [shell],
        stdin=slave_fd,
        stdout=slave_fd,
        stderr=slave_fd,
        close_fds=True,
        env=env,
        preexec_fn=os.setsid # Create a new session
    )
    
    # Write the inner shell's PID to stderr so Node.js can track its CWD
    sys.stderr.write(f"__DNET_SHELL_PID__:{p.pid}\n")
    sys.stderr.flush()
    
    # Close slave fd in parent
    os.close(slave_fd)
    
    # Set non-blocking
    fcntl.fcntl(master_fd, fcntl.F_SETFL, fcntl.fcntl(master_fd, fcntl.F_GETFL) | os.O_NONBLOCK)
    
    # Setup control fd if it exists
    control_fd = None
    try:
        os.fstat(3)
        control_fd = 3
        fcntl.fcntl(control_fd, fcntl.F_SETFL, fcntl.fcntl(control_fd, fcntl.F_GETFL) | os.O_NONBLOCK)
    except Exception:
        pass
        
    # Also set stdin non-blocking
    fcntl.fcntl(sys.stdin.fileno(), fcntl.F_SETFL, fcntl.fcntl(sys.stdin.fileno(), fcntl.F_GETFL) | os.O_NONBLOCK)

    # Buffer for control fd
    control_buffer = b""

    try:
        while True:
            # Check if shell process is still alive
            if p.poll() is not None:
                break
                
            read_fds = [master_fd, sys.stdin.fileno()]
            if control_fd is not None:
                read_fds.append(control_fd)
                
            r, w, x = select.select(read_fds, [], [], 0.05)
            
            # Read from master (pty output) and write to stdout
            if master_fd in r:
                try:
                    data = os.read(master_fd, 1024 * 16)
                    if data:
                        sys.stdout.buffer.write(data)
                        sys.stdout.buffer.flush()
                    else:
                        break
                except BlockingIOError:
                    pass
                except OSError:
                    break
                    
            # Read from stdin (user input) and write to master
            if sys.stdin.fileno() in r:
                try:
                    data = os.read(sys.stdin.fileno(), 1024 * 16)
                    if data:
                        os.write(master_fd, data)
                    else:
                        break
                except BlockingIOError:
                    pass
                except OSError:
                    break
                    
            # Read from control fd (resize commands)
            if control_fd is not None and control_fd in r:
                try:
                    data = os.read(control_fd, 1024)
                    if data:
                        control_buffer += data
                        while b"\n" in control_buffer:
                            line, control_buffer = control_buffer.split(b"\n", 1)
                            try:
                                cmd = json.loads(line.decode('utf-8'))
                                if cmd.get("type") == "resize":
                                    rows = cmd.get("rows", 24)
                                    cols = cmd.get("cols", 80)
                                    set_size_unix(master_fd, rows, cols)
                            except Exception as ex:
                                sys.stderr.write(f"Control parse error: {ex}\n")
                                sys.stderr.flush()
                    else:
                        control_fd = None
                except BlockingIOError:
                    pass
                except OSError:
                    control_fd = None
                    
    except KeyboardInterrupt:
        pass
    finally:
        try:
            os.close(master_fd)
        except Exception:
            pass
        try:
            p.terminate()
        except Exception:
            pass

def run_threaded_fallback():
    # Setup shell based on platform
    if os.name == 'nt':
        # Default to standard command prompt on Windows
        shell = ["cmd.exe"]
    else:
        # Non-Windows fallback if PTY isn't available
        shell = ["/bin/bash"]
        if not os.path.exists("/bin/bash"):
            shell = ["/bin/sh"]

    env = os.environ.copy()
    env["TERM"] = "xterm-256color"
    env["COLORTERM"] = "truecolor"

    try:
        p = subprocess.Popen(
            shell,
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
            env=env,
            shell=False
        )
    except Exception:
        if os.name == 'nt' and shell != ["cmd.exe"]:
            p = subprocess.Popen(
                ["cmd.exe"],
                stdin=subprocess.PIPE,
                stdout=subprocess.PIPE,
                stderr=subprocess.PIPE,
                env=env,
                shell=False
            )
        else:
            raise

    # Write the inner shell's PID to stderr so Node.js can track its CWD
    sys.stderr.write(f"__DNET_SHELL_PID__:{p.pid}\n")
    sys.stderr.flush()

    # Read from process stdout and stream to system stdout
    def read_stdout():
        try:
            while True:
                data = p.stdout.read(1)
                if not data:
                    break
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        except Exception:
            pass

    # Read from process stderr and stream to system stdout
    def read_stderr():
        try:
            while True:
                data = p.stderr.read(1)
                if not data:
                    break
                sys.stdout.buffer.write(data)
                sys.stdout.buffer.flush()
        except Exception:
            pass

    # Read from system stdin and stream to process stdin
    def read_stdin():
        try:
            while True:
                data = sys.stdin.buffer.read(1)
                if not data:
                    break
                p.stdin.write(data)
                p.stdin.flush()
        except Exception:
            pass

    # Read control commands from fd 3 if available
    control_fd = None
    try:
        os.fstat(3)
        control_fd = 3
    except Exception:
        pass

    def read_control():
        if control_fd is None:
            return
        try:
            f = os.fdopen(control_fd, "rb")
            while True:
                line = f.readline()
                if not line:
                    break
                # Control channel JSON processing
        except Exception:
            pass

    t1 = threading.Thread(target=read_stdout, daemon=True)
    t2 = threading.Thread(target=read_stderr, daemon=True)
    t3 = threading.Thread(target=read_stdin, daemon=True)

    t1.start()
    t2.start()
    t3.start()

    if control_fd is not None:
        t4 = threading.Thread(target=read_control, daemon=True)
        t4.start()

    try:
        p.wait()
    except KeyboardInterrupt:
        p.terminate()

def main():
    if HAS_PTY:
        run_unix_pty()
    else:
        run_threaded_fallback()

if __name__ == "__main__":
    main()
