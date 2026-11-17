"""L4: komut satırı (`python -m oyun_server`, `canli.sh`) ve süreç sonlandırma (Ö6)."""
import os
import signal
import subprocess
import sys
import tempfile
import time
import unittest

from tests.cli_helpers import CANLI_SH, SERVER_ROOT, ServerProc, children_of, pid_alive, server_env, wait_gone


def run_cli(args, env_extra=None, timeout=20):
    return subprocess.run([sys.executable, "-P", "-m", "oyun_server", *args], cwd=SERVER_ROOT, env=server_env(env_extra),
                          capture_output=True, text=True, timeout=timeout)


def run_sh(args, env_extra=None, timeout=20):
    return subprocess.run(["bash", str(CANLI_SH), *args], env=server_env(env_extra), capture_output=True, text=True,
                          timeout=timeout)


class CliRefusals(unittest.TestCase):
    def test_cli_refuses_non_loopback(self):
        for host in ("0.0.0.0", "::", "192.168.1.5"):
            p = run_cli(["--host", host, "--host-kind", "fake", "--port", "0"])
            self.assertEqual(p.returncode, 2, host)
            self.assertIn("127.0.0.1", p.stderr)
            self.assertIn("yalnız", p.stderr)

    def test_cli_missing_model_message_in_turkish(self):
        with tempfile.TemporaryDirectory() as d:
            p = run_cli(["--port", "0"], {"OYUN_MODEL_ROOT": d})
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("model dizini bulunamadı", p.stderr)
        self.assertIn("OYUN_MODEL_ROOT", p.stderr)
        self.assertIn("--host-kind fake", p.stderr)
        self.assertNotIn("Traceback", p.stderr)


class CanliSh(unittest.TestCase):
    def test_canli_sh_exists_and_executable(self):
        self.assertTrue(CANLI_SH.is_file(), CANLI_SH)
        self.assertTrue(os.access(CANLI_SH, os.X_OK))

    def test_canli_sh_missing_model_message_in_turkish(self):
        with tempfile.TemporaryDirectory() as d:
            p = run_sh(["--port", "0"], {"OYUN_MODEL_ROOT": d})
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("model dizini bulunamadı", p.stderr)
        self.assertIn("--fake", p.stderr)

    def test_canli_sh_old_python_message(self):
        p = run_sh(["--fake", "--port", "0"], {"OYUN_PYTHON": "/usr/bin/false"})
        self.assertNotEqual(p.returncode, 0)
        self.assertIn("3.12", p.stderr)

    def test_canli_sh_unknown_option(self):
        p = run_sh(["--host", "0.0.0.0"])
        self.assertEqual(p.returncode, 2)
        self.assertIn("bilinmeyen seçenek", p.stderr)

    def test_canli_sh_warns_without_build_and_prints_address(self):
        with tempfile.TemporaryDirectory() as d:
            gone = os.path.join(d, "yok")
            s = ServerProc(cmd=["bash", str(CANLI_SH), "--fake", "--port", "0"], env_extra={"OYUN_WEB_DIR": gone})
            try:
                self.assertEqual(s.req("GET", "/api/hello")[0], 200)
                self.assertEqual(s.port is not None, True)
            finally:
                s.stop()
                out = s.output()
                s.kill()
            self.assertIn("pnpm --filter web build", out)
            self.assertIn(f"http://127.0.0.1:{s.port}/oyun/", out)
        self.assertFalse(pid_alive(s.pid))


class StartUrl(unittest.TestCase):
    """Başlangıç satırı ve `--open` URL'si: 8765 dışı kapıda `?kaynak=canli` (arayüz aynı kökeni yoklasın)."""

    def test_start_url_rule(self):
        from oyun_server.__main__ import start_url
        self.assertEqual(start_url(8765), "http://127.0.0.1:8765/oyun/")
        self.assertEqual(start_url(9000), "http://127.0.0.1:9000/oyun/?kaynak=canli")

    def test_server_prints_forced_live_url_on_custom_port(self):
        s = ServerProc(args=["--host-kind", "fake"])
        try:
            self.assertIn(f"http://127.0.0.1:{s.port}/oyun/?kaynak=canli", s.output() or "".join(s.lines))
        finally:
            s.stop()
            s.kill()

    def test_canli_sh_open_uses_forced_live_url_for_custom_port(self):
        import socket
        with tempfile.TemporaryDirectory() as d:
            out = os.path.join(d, "opened.txt")
            shim = os.path.join(d, "opener")
            with open(shim, "w") as fh:
                fh.write('#!/bin/sh\necho "$1" > "%s"\n' % out)
            os.chmod(shim, 0o755)
            s = None
            for _ in range(5):                    # kapı yalnız --open URL'si için önceden bilinmeli; çakışırsa yeniden dene
                sock = socket.socket()
                sock.bind(("127.0.0.1", 0))
                port = sock.getsockname()[1]
                sock.close()
                try:
                    s = ServerProc(cmd=["bash", str(CANLI_SH), "--fake", "--port", str(port), "--open"],
                                   env_extra={"OYUN_OPEN_CMD": shim, "OYUN_WEB_DIR": os.path.join(d, "yok")})
                    break
                except RuntimeError:
                    continue
            self.assertIsNotNone(s, "sunucu başlamadı")
            try:
                end = time.monotonic() + 30
                while time.monotonic() < end and not os.path.exists(out):
                    time.sleep(0.05)
                self.assertTrue(os.path.exists(out), "--open açıcıyı çağırmadı")
                want = f"http://127.0.0.1:{port}/oyun/?kaynak=canli"
                got = ""
                end = time.monotonic() + 30             # açıcı dosyayı yazarken yarım okunabilir: tam içerik beklenir
                while time.monotonic() < end:
                    with open(out) as fh:
                        got = fh.read()
                    if got.endswith("\n") and got.strip() == want:
                        break
                    time.sleep(0.05)
                self.assertEqual(got.strip(), want)
            finally:
                s.stop()
                s.kill()


class Signals(unittest.TestCase):
    def _server_with_run(self, step_ms="0"):
        s = ServerProc(args=["--host-kind", "fake"], env_extra={"OYUN_FAKE_STEP_MS": step_ms})
        self.addCleanup(s.kill)
        rid = s.create_run()
        st, _ = s.req("POST", f"/api/runs/{rid}/control", {"action": "play", "speed": 1})
        self.assertEqual(st, 200)
        deadline = time.monotonic() + 10
        workers = []
        while time.monotonic() < deadline and not workers:
            workers = children_of(s.pid)
            time.sleep(0.05)
        self.assertTrue(workers, "işçi süreç görünmüyor")
        return s, workers

    def test_sigint_kills_all_workers(self):
        s, workers = self._server_with_run()
        s.proc.send_signal(signal.SIGINT)
        s.proc.wait(30)
        self.assertEqual(wait_gone(workers, 15.0), [], "işçiler 15 sn içinde ölmedi")
        self.assertFalse(pid_alive(s.pid))

    def test_sigkill_parent_workers_exit_by_stdin_eof(self):
        s, workers = self._server_with_run(step_ms="200")
        os.kill(s.pid, signal.SIGKILL)
        s.proc.wait(30)
        # ≤ 1 adım (200 ms) + EOF okuması; yük altında geniş pay
        self.assertEqual(wait_gone(workers, 15.0), [], "ana süreç ölünce işçi EOF ile çıkmadı")


if __name__ == "__main__":
    unittest.main()
