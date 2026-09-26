"""Boot exam backend (:8001), check health + Luna chat, then exit."""
import json
import subprocess
import time
import urllib.request
import urllib.error

srv = subprocess.Popen(["uv", "run", "uvicorn", "app.main:app", "--port", "8001"],
                       cwd="apps/api", stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
try:
    for _ in range(45):
        time.sleep(1)
        try:
            with urllib.request.urlopen("http://localhost:8001/health", timeout=3) as r:
                print("health:", r.status, r.read().decode()[:300])
            break
        except Exception:
            continue
    else:
        print("BACKEND_NEVER_UP");
        raise SystemExit

    # Luna chat check (small, real request)
    try:
        req = urllib.request.Request(
            "http://localhost:8001/chat",
            data=json.dumps({"messages": [{"role": "user", "content": "reply with: ok"}]}).encode(),
            headers={"Content-Type": "application/json"},
        )
        with urllib.request.urlopen(req, timeout=60) as r:
            print("chat:", r.status, r.read().decode()[:300])
    except urllib.error.HTTPError as e:
        print("chat HTTP", e.code, e.read().decode()[:500])
    except Exception as e:
        print("chat FAIL", type(e).__name__, str(e)[:300])
finally:
    srv.kill()
    srv.wait(timeout=15)
print("DIAG_DONE")
