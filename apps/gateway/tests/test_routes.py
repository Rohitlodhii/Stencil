from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from app import main as gateway


def test_demo_report_is_forwarded_to_exam_api(monkeypatch):
    async def fake_proxy(request, target_base, path):
        return JSONResponse({"target": target_base, "path": path})

    monkeypatch.setattr(gateway, "_proxy", fake_proxy)
    response = TestClient(gateway.app).get("/demo/report")

    assert response.status_code == 200
    assert response.json() == {
        "target": gateway.EXAM_API_URL,
        "path": "/demo/report",
    }
