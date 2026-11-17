"""S3: `/api/jobs` uç noktaları. İş mantığı `JobManager`'da; burada yalnız doğrulama ve hata gövdeleri."""
from __future__ import annotations

import re

from ..http import Request, Response, Route
from ..registry.schema import RunConfigError
from ..security import HttpError
from .manager import JobBusy, UnknownJob


def make_routes(app) -> list[Route]:
    jobs = app.jobs

    def not_found() -> HttpError:
        return HttpError(404, "not_found", "Bu iş bulunamadı.")

    def start(req: Request) -> Response:
        body = req.json()
        try:
            job_id = jobs.start(body)
        except RunConfigError as e:
            raise HttpError(422, "invalid_job", "İş isteği geçersiz.", [{"id": x.id, "reason": x.reason} for x in e.errors])
        except JobBusy:
            raise HttpError(409, "job_running", "Başka bir iş sürüyor; bitmesini ya da iptalini bekleyin.")
        return Response.json({"jobId": job_id}, 201)

    def get(req: Request) -> Response:
        try:
            return Response.json(jobs.get(req.params["id"]))
        except UnknownJob:
            raise not_found()

    def cancel(req: Request) -> Response:
        try:
            return Response.json(jobs.cancel(req.params["id"]))
        except UnknownJob:
            raise not_found()

    jid = r"(?P<id>[^/]+)"
    return [
        Route("POST", re.compile(r"/jobs"), start),
        Route("GET", re.compile(rf"/jobs/{jid}"), get),
        Route("DELETE", re.compile(rf"/jobs/{jid}"), cancel),
    ]
