"""No-cache static file mount.

Wraps Starlette's StaticFiles so every response from /static/* carries
no-cache headers. This guarantees users get the latest JS after a deploy
without manual cache busting.
"""
from __future__ import annotations

from starlette.staticfiles import StaticFiles


class NoCacheStatic(StaticFiles):
    async def get_response(self, path: str, scope: dict):
        response = await super().get_response(path, scope)
        response.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
        response.headers["Pragma"] = "no-cache"
        response.headers["Expires"] = "0"
        return response