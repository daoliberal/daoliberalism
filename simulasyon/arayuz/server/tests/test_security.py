import re
import unittest

from oyun_server import security
from oyun_server.http import Response, Route, make_server
from oyun_server.security import HttpError, check_request

from tests.helpers import HEADERS_POST, jbody, request, running

DEV = "http://localhost:3000"


class CheckRequestUnit(unittest.TestCase):
    def ok(self, method, headers, allowed=()):
        check_request(method, "/api/x", headers, set(allowed), 8765)

    def err(self, method, headers, allowed=()):
        with self.assertRaises(HttpError) as c:
            self.ok(method, headers, allowed)
        return c.exception

    def test_header_names_case_insensitive(self):
        self.ok("GET", {"HOST": "127.0.0.1:8765"})

    def test_bad_host_variants(self):
        for h in ("evil.example", "127.0.0.1:1", "127.0.0.1", "localhost:8765.evil.example", None):
            e = self.err("GET", {"Host": h} if h else {})
            self.assertEqual((e.status, e.code), (400, "bad_host"))

    def test_origin_rules(self):
        host = {"Host": "localhost:8765"}
        self.ok("GET", dict(host, Origin="http://localhost:8765"))
        self.assertEqual(self.err("GET", dict(host, Origin=DEV)).status, 403)
        self.ok("GET", dict(host, Origin=DEV), allowed=[DEV])
        self.assertEqual(self.err("GET", dict(host, Origin="null")).status, 403)

    def test_mutating_requirements(self):
        h = {"Host": "127.0.0.1:8765", "Origin": "http://127.0.0.1:8765", "Content-Type": "application/json",
             "X-Oyun-Istek": "1"}
        self.ok("POST", h)
        self.ok("DELETE", h)
        for drop, status in (("Origin", 403), ("X-Oyun-Istek", 403), ("Content-Type", 415)):
            bad = {k: v for k, v in h.items() if k != drop}
            self.assertEqual(self.err("POST", bad).status, status, drop)
        self.assertEqual(self.err("POST", dict(h, **{"Content-Type": "text/plain"})).status, 415)
        self.ok("POST", dict(h, **{"Content-Type": "application/json; charset=utf-8"}))

    def test_options_needs_allowed_origin(self):
        host = {"Host": "127.0.0.1:8765"}
        self.assertEqual(self.err("OPTIONS", host).status, 403)
        self.assertEqual(self.err("OPTIONS", dict(host, Origin="http://evil.example")).status, 403)
        self.ok("OPTIONS", dict(host, Origin=DEV), allowed=[DEV])


class SecurityHttp(unittest.TestCase):
    def test_binds_loopback_only(self):
        for bad in ("0.0.0.0", "::", "", "localhost", "192.168.1.5"):
            with self.assertRaises(ValueError):
                make_server(0, [], None, set(), host=bad)
        with running() as srv:
            self.assertEqual(srv.server_address[0], "127.0.0.1")
            self.assertTrue(srv.daemon_threads)

    def test_bad_host_rejected(self):
        with running() as srv:
            s, h, b = request(srv, "GET", "/api/hello", {"Host": "evil.example"})
            self.assertEqual(s, 400)
            self.assertEqual(jbody(b)["error"]["code"], "bad_host")

    def test_foreign_origin_blocked(self):
        with running() as srv:
            s, h, b = request(srv, "GET", "/api/hello", {"Origin": "http://evil.example"})
            self.assertEqual(s, 403)
            self.assertNotIn("access-control-allow-origin", h)
            self.assertEqual(jbody(b)["error"]["code"], "bad_origin")
            # :3201 varsayılan listede yok
            s, h, _ = request(srv, "GET", "/api/hello", {"Origin": "http://localhost:3201"})
            self.assertEqual(s, 403)

    def test_allowed_origin_cors(self):
        with running(origins=[DEV]) as srv:
            s, h, _ = request(srv, "GET", "/api/hello", {"Origin": DEV})
            self.assertEqual(s, 200)
            self.assertEqual(h["access-control-allow-origin"], DEV)
            self.assertIn("Origin", h["vary"])
            self.assertNotIn("access-control-allow-credentials", h)
            s, h, _ = request(srv, "GET", "/api/hello")
            self.assertNotIn("access-control-allow-origin", h)
            self.assertIn("Origin", h["vary"])

    def test_post_requires_origin_header_and_json(self):
        with running() as srv:
            own = f"http://127.0.0.1:{srv.port}"
            body = b'{"a":1}'
            good = dict(HEADERS_POST, Origin=own)
            s, _, b = request(srv, "POST", "/api/echo", good, body)
            self.assertEqual((s, jbody(b)), (200, {"got": {"a": 1}}))
            s, _, b = request(srv, "POST", "/api/echo", HEADERS_POST, body)  # Origin yok
            self.assertEqual((s, jbody(b)["error"]["code"]), (403, "missing_origin"))
            s, _, b = request(srv, "POST", "/api/echo", {k: v for k, v in good.items() if k != "X-Oyun-Istek"}, body)
            self.assertEqual((s, jbody(b)["error"]["code"]), (403, "missing_header"))
            s, _, b = request(srv, "POST", "/api/echo", dict(good, **{"Content-Type": "text/plain"}), body)
            self.assertEqual((s, jbody(b)["error"]["code"]), (415, "unsupported_media"))
            for bad in (b"{", b"[1]", b"NaN", b"", b'{"a": NaN}'):
                s, _, b = request(srv, "POST", "/api/echo", good, bad)
                self.assertEqual((s, jbody(b)["error"]["code"]), (400, "bad_json"), bad)

    def test_delete_requires_origin_and_header_not_content_type(self):
        routes = [Route("DELETE", re.compile(r"/runs/(?P<id>[a-z0-9]+)"), lambda req: Response(204))]
        with running(routes=routes) as srv:
            own = {"Origin": f"http://127.0.0.1:{srv.port}"}
            self.assertEqual(request(srv, "DELETE", "/api/runs/a1", dict(own, **{"X-Oyun-Istek": "1"}))[0], 204)
            self.assertEqual(request(srv, "DELETE", "/api/runs/a1", {"X-Oyun-Istek": "1"})[0], 403)
            self.assertEqual(request(srv, "DELETE", "/api/runs/a1", own)[0], 403)

    def test_base_class_errors_are_turkish_json(self):
        import socket
        with running() as srv:
            for line, code in ((b"TRACE / HTTP/1.1\r\nHost: 127.0.0.1:%d\r\n\r\n" % srv.port, 501),):
                s = socket.create_connection(("127.0.0.1", srv.port), timeout=5)
                s.sendall(line)
                raw = b""
                while b"\r\n\r\n" not in raw:                  # tek recv başlık/gövdeyi bölebilir: tam başlığı bekle
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    raw += chunk
                head, _, body = raw.partition(b"\r\n\r\n")
                m = re.search(rb"(?i)content-length:\s*(\d+)", head)
                while m and len(body) < int(m.group(1)):
                    chunk = s.recv(65536)
                    if not chunk:
                        break
                    body += chunk
                data = (head + b"\r\n\r\n" + body).decode()
                s.close()
                self.assertIn(f" {code} ", data.split("\r\n")[0])
                msg = jbody(data.split("\r\n\r\n", 1)[1].encode())["error"]["message"]
                self.assertNotIn("Unsupported", msg)
                self.assertIn("desteklenmiyor", msg)

    def test_preflight_only_for_allowed(self):
        with running(origins=[DEV]) as srv:
            pre = {"Origin": DEV, "Access-Control-Request-Method": "POST",
                   "Access-Control-Request-Headers": "content-type, x-oyun-istek"}
            s, h, _ = request(srv, "OPTIONS", "/api/echo", pre)
            self.assertEqual(s, 204)
            self.assertEqual(h["access-control-allow-origin"], DEV)
            self.assertIn("X-Oyun-Istek", h["access-control-allow-headers"])
            self.assertIn("POST", h["access-control-allow-methods"])
            s, h, _ = request(srv, "OPTIONS", "/api/echo", dict(pre, Origin="http://evil.example"))
            self.assertEqual(s, 403)
            self.assertNotIn("access-control-allow-origin", h)
            s, h, _ = request(srv, "OPTIONS", "/api/echo", {})
            self.assertEqual(s, 403)

    def test_body_too_large_413(self):
        with running() as srv:
            own = f"http://127.0.0.1:{srv.port}"
            hdr = dict(HEADERS_POST, Origin=own)
            s, _, b = request(srv, "POST", "/api/echo", hdr, b"x" * (65 * 1024))
            self.assertEqual((s, jbody(b)["error"]["code"]), (413, "body_too_large"))
            body = b'{"k":"' + b"x" * (60 * 1024) + b'"}'  # sınır altı geçer
            s, _, _ = request(srv, "POST", "/api/echo", hdr, body)
            self.assertEqual(s, 200)

    def test_errors_always_json_never_500(self):
        with running() as srv:
            own = f"http://127.0.0.1:{srv.port}"
            cases = [
                ("GET", "/api/yok", None, 404),
                ("POST", "/api/hello", dict(HEADERS_POST, Origin=own), 405),
                ("GET", "/api/echo", None, 405),
                ("GET", "/yok", None, 404),
                ("GET", "/api/item/ab12", None, 200),
                ("GET", "/api/" + "a" * 70000, None, 414),
            ]
            for m, p, h, want in cases:
                s, hd, b = request(srv, m, p, h, b"{}" if m == "POST" else None)
                self.assertEqual(s, want, (m, p))
                self.assertIn("application/json", hd["content-type"], (m, p))
                jbody(b)
            s, hd, b = request(srv, "POST", "/api/hello", dict(HEADERS_POST, Origin=own), b"{}")
            self.assertEqual(hd["allow"], "GET")

    def test_handler_exception_is_json_500_and_server_survives(self):
        with running() as srv:
            s, hd, b = request(srv, "GET", "/api/boom")
            self.assertEqual((s, jbody(b)["error"]["code"]), (500, "internal"))
            self.assertEqual(request(srv, "GET", "/api/hello")[0], 200)


if __name__ == "__main__":
    unittest.main()
