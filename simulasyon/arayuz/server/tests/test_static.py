import os
import tempfile
import unittest
from pathlib import Path

from oyun_server import static

from tests.helpers import jbody, request, running

OUT = Path(__file__).resolve().parents[4] / "apps" / "web" / "out"


def make_web(root: Path, outside: Path):
    (root / "oyun").mkdir(parents=True)
    (root / "_next" / "static" / "chunks").mkdir(parents=True)
    (root / "oyun-kayit").mkdir()
    (root / "oyun" / "index.html").write_text(
        '<!doctype html><html><head><script src="/_next/static/chunks/x.js" async></script></head>'
        "<body>oyun</body></html>", encoding="utf-8")
    (root / "index.html").write_text("<!doctype html>kok", encoding="utf-8")
    (root / "_next" / "static" / "chunks" / "x.js").write_text("console.log(1)", encoding="utf-8")
    (root / "oyun-kayit" / "index.json").write_text('{"runs":[]}', encoding="utf-8")
    for name, data in (("a.css", "a{}"), ("a.woff2", "w"), ("a.svg", "<svg/>"), ("a.png", "p"), ("a.txt", "t"),
                       ("a.bin", "b"), (".env", "SECRET")):
        (root / name).write_text(data, encoding="utf-8")
    (outside / "secret.txt").write_text("TOP-SECRET", encoding="utf-8")
    os.symlink(outside, root / "oyun-kayit" / "simge")           # dizin simge bağlantısı dışarı
    os.symlink(outside / "secret.txt", root / "sir.txt")          # dosya simge bağlantısı dışarı


class StaticServing(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        base = Path(self.tmp.name)
        self.root, outside = base / "out", base / "disari"
        outside.mkdir()
        self.root.mkdir()
        make_web(self.root, outside)

    def tearDown(self):
        self.tmp.cleanup()

    def test_static_serves_oyun_index(self):
        import re
        with running(self.root) as srv:
            s, h, b = request(srv, "GET", "/oyun/?kaynak=canli")
            self.assertEqual(s, 200)
            self.assertTrue(h["content-type"].startswith("text/html"))
            self.assertNotIn("cache-control", h)  # no-store yalnız /api'de
            link = re.search(r'src="(/_next/static/[^"]+\.js)"', b.decode()).group(1)
            s, h, _ = request(srv, "GET", link)
            self.assertEqual(s, 200)
            self.assertTrue(h["content-type"].startswith("text/javascript"))
            s, h, b = request(srv, "GET", "/oyun-kayit/index.json")
            self.assertEqual(s, 200)
            self.assertTrue(h["content-type"].startswith("application/json"))
            self.assertEqual(request(srv, "GET", "/")[0], 200)  # dizin isteği index.html
            self.assertEqual(request(srv, "GET", "/yok.js")[0], 404)
            s, h, _ = request(srv, "GET", "/oyun")
            self.assertEqual((s, h["location"]), (302, "/oyun/?kaynak=canli"))
            s, h, b = request(srv, "HEAD", "/oyun/?kaynak=canli")
            self.assertEqual((s, b), (200, b""))
            self.assertGreater(int(h["content-length"]), 0)

    def test_oyun_kaynak_yonlendirmesi(self):
        with running(self.root) as srv:
            for yol in ("/oyun", "/oyun/", "/oyun/index.html"):
                s, h, _ = request(srv, "GET", yol)
                self.assertEqual((s, h["location"], h["cache-control"]), (302, "/oyun/?kaynak=canli", "no-store"), yol)
            s, h, _ = request(srv, "HEAD", "/oyun/")
            self.assertEqual((s, h["location"]), (302, "/oyun/?kaynak=canli"))
            s, h, _ = request(srv, "GET", "/oyun/?a=1&b=iki")
            self.assertEqual((s, h["location"]), (302, "/oyun/?a=1&b=iki&kaynak=canli"))
            s, h, _ = request(srv, "GET", "/oyun/?")
            self.assertEqual((s, h["location"]), (302, "/oyun/?kaynak=canli"))
            for q in ("kaynak=canli", "kaynak=kayit", "a=1&kaynak=kayit", "kaynak="):
                s, h, b = request(srv, "GET", "/oyun/?" + q)
                self.assertEqual(s, 200, q)
                self.assertNotIn("location", h)
                self.assertIn(b"oyun", b)
            # öteki yollar etkilenmez
            self.assertEqual(request(srv, "GET", "/_next/static/chunks/x.js")[0], 200)
            self.assertEqual(request(srv, "GET", "/oyun-kayit/index.json")[0], 200)
            self.assertEqual(request(srv, "GET", "/")[0], 200)
            self.assertEqual(request(srv, "GET", "/api/hello")[0], 200)

    def test_mime_table(self):
        want = {"a.css": "text/css", "a.woff2": "font/woff2", "a.svg": "image/svg+xml", "a.png": "image/png",
                "a.txt": "text/plain", "a.bin": "application/octet-stream",
                "_next/static/chunks/x.js": "text/javascript", "oyun-kayit/index.json": "application/json",
                "oyun/index.html?kaynak=kayit": "text/html"}
        with running(self.root) as srv:
            for p, mt in want.items():
                s, h, _ = request(srv, "GET", "/" + p)
                self.assertEqual(s, 200, p)
                self.assertTrue(h["content-type"].startswith(mt), (p, h["content-type"]))

    def test_api_takes_priority_and_no_store_only_on_api(self):
        (self.root / "api").mkdir()
        (self.root / "api" / "hello").write_text("STATIK", encoding="utf-8")
        with running(self.root) as srv:
            s, h, b = request(srv, "GET", "/api/hello")
            self.assertEqual(jbody(b)["ok"], True)
            self.assertEqual(h["cache-control"], "no-store")
            self.assertEqual(request(srv, "GET", "/api/yok")[0], 404)  # statiğe düşmez
            s, h, b = request(srv, "GET", "/apix")
            self.assertEqual(s, 404)
            self.assertNotIn("cache-control", h)

    def test_static_path_traversal(self):
        with running(self.root) as srv:
            paths = ["/../../etc/passwd", "/%2e%2e/%2e%2e/etc/passwd", "/%252e%252e/%252e%252e/etc/passwd",
                     "/oyun/../../disari/secret.txt", "/..%2f..%2fetc/passwd", "/%2e%2e%5c%2e%2e%5cetc%5cpasswd",
                     "/oyun-kayit/simge/secret.txt", "/oyun-kayit/simge/", "/sir.txt", "/.env", "/%00",
                     "/oyun/%00.html", "//etc/passwd", "/%ff"]
            for p in paths:
                s, h, b = request(srv, "GET", p)
                self.assertIn(s, (404, 301), p)
                self.assertNotIn(b"TOP-SECRET", b, p)
                self.assertNotIn(b"root:", b, p)
                if s == 404:
                    jbody(b)

    def test_lookup_unit(self):
        self.assertIsNone(static.lookup(None, "/"))
        self.assertEqual(static.lookup(self.root, "/")[0], "file")
        self.assertIsNone(static.lookup(self.root, "/a/../../x"))

    def test_no_web_root_is_json_404(self):
        with running(None) as srv:
            s, h, b = request(srv, "GET", "/oyun/")
            self.assertEqual((s, jbody(b)["error"]["code"]), (404, "not_found"))
            self.assertEqual(request(srv, "GET", "/api/hello")[0], 200)

    @unittest.skipUnless(os.path.isdir(OUT / "oyun"), "apps/web/out yok (yalnız L4 tam modunda zorunlu)")
    def test_real_out_oyun_index(self):
        import re
        with running(OUT) as srv:
            s, _, b = request(srv, "GET", "/oyun/?kaynak=canli")
            self.assertEqual(s, 200)
            link = re.search(r'/_next/static/[^"\']+\.js', b.decode()).group(0)
            self.assertEqual(request(srv, "GET", link)[0], 200)
            self.assertEqual(request(srv, "GET", "/oyun-kayit/index.json")[0], 200)


if __name__ == "__main__":
    unittest.main()
