#!/usr/bin/env python3
import json
import time
import urllib.request
from websocket import create_connection

EXT_PATH = "/opt/gmgn/extension"


def targets():
    return json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/list"))


def browser_ws():
    ver = json.load(urllib.request.urlopen("http://127.0.0.1:9222/json/version"))
    return ver["webSocketDebuggerUrl"]


def wait_id(sock, want, timeout=12):
    end = time.time() + timeout
    while time.time() < end:
        sock.settimeout(max(0.2, end - time.time()))
        try:
            msg = json.loads(sock.recv())
        except Exception:
            continue
        if msg.get("id") == want:
            return msg
    return {}


def service_worker():
    for target in targets():
        url = target.get("url") or ""
        if target.get("type") == "service_worker" and "worker.js" in url:
            return target
    return None


def load_unpacked():
    ws = create_connection(browser_ws(), timeout=20)
    ws.send(json.dumps({
        "id": 1,
        "method": "Extensions.loadUnpacked",
        "params": {"path": EXT_PATH},
    }))
    wait_id(ws, 1, 15)
    ws.close()


def enable_extension():
    bws = create_connection(browser_ws(), timeout=20)
    bws.send(json.dumps({
        "id": 1,
        "method": "Target.createTarget",
        "params": {"url": "chrome://extensions/"},
    }))
    created = wait_id(bws, 1, 8)
    bws.close()
    tid = created.get("result", {}).get("targetId")
    if not tid:
        return
    time.sleep(1)
    page = next((t for t in targets() if t.get("id") == tid), None)
    if not page:
        return
    ws = create_connection(page["webSocketDebuggerUrl"], timeout=15)
    expr = r"""
(() => {
  const mgr = document.querySelector('extensions-manager');
  if (!mgr || !mgr.shadowRoot) return 'no-manager';
  const toolbar = mgr.shadowRoot.querySelector('extensions-toolbar');
  const dev = toolbar && toolbar.shadowRoot && toolbar.shadowRoot.querySelector('#devMode');
  if (dev && !dev.checked) dev.click();
  const list = mgr.shadowRoot.querySelector('extensions-item-list');
  const items = list && list.shadowRoot ? list.shadowRoot.querySelectorAll('extensions-item') : [];
  items.forEach((item) => {
    const nameEl = item.shadowRoot && item.shadowRoot.querySelector('#name');
    const name = nameEl ? nameEl.innerText : '';
    const toggle = item.shadowRoot && item.shadowRoot.querySelector('cr-toggle');
    if (name.indexOf('GMGN') !== -1 && toggle && !toggle.checked) toggle.click();
  });
  return 'ok';
})()
"""
    ws.send(json.dumps({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {"expression": expr, "returnByValue": True},
    }))
    wait_id(ws, 1, 8)
    ws.close()
    bws = create_connection(browser_ws(), timeout=15)
    bws.send(json.dumps({"id": 1, "method": "Target.closeTarget", "params": {"targetId": tid}}))
    wait_id(bws, 1, 5)
    bws.close()


def wait_worker(seconds):
    end = time.time() + seconds
    while time.time() < end:
        if service_worker():
            return True
        time.sleep(0.5)
    return False


def read_status(start):
    target = service_worker()
    if not target:
        return None
    expr = r"""
(async () => {
  let st = await statusPayload();
  if (!st.running) st = await startScan();
  const settings = await getSettings();
  return JSON.stringify({
    running: !!st.running,
    chain: st.chain || '',
    chains: GmgnParse.enabledChainOrder(settings.chains).length,
    hasError: !!st.error
  });
})()
"""
    if not start:
        expr = r"""
(async () => {
  const st = await statusPayload();
  const settings = await getSettings();
  return JSON.stringify({
    running: !!st.running,
    chain: st.chain || '',
    chains: GmgnParse.enabledChainOrder(settings.chains).length,
    hasError: !!st.error
  });
})()
"""
    ws = create_connection(target["webSocketDebuggerUrl"], timeout=30)
    ws.send(json.dumps({
        "id": 1,
        "method": "Runtime.evaluate",
        "params": {"expression": expr, "awaitPromise": True, "returnByValue": True},
    }))
    msg = wait_id(ws, 1, 25)
    ws.close()
    value = msg.get("result", {}).get("result", {}).get("value")
    if not value:
        return None
    return json.loads(value)


def main():
    end = time.time() + 40
    while time.time() < end:
        try:
            urllib.request.urlopen("http://127.0.0.1:9222/json/version", timeout=1).read()
            break
        except Exception:
            time.sleep(0.5)
    else:
        print("debug-port-down")
        return 1

    if not wait_worker(20):
        try:
            load_unpacked()
        except Exception:
            pass
    if not wait_worker(10):
        try:
            enable_extension()
            load_unpacked()
        except Exception:
            pass
    if not wait_worker(15):
        print("extension-down")
        return 1

    status = None
    for _ in range(15):
        try:
            status = read_status(False)
        except Exception:
            status = None
        if status and status.get("running"):
            break
        time.sleep(1)
    if not status or not status.get("running"):
        try:
            status = read_status(True)
        except Exception:
            status = None
    if not status or not status.get("running"):
        print("scan-down")
        return 1
    print("running chain=%s chains=%s error=%s" % (
        status.get("chain") or "",
        status.get("chains") or 0,
        "yes" if status.get("hasError") else "no",
    ))
    try:
        bws = create_connection(browser_ws(), timeout=15)
        n = 1
        for target in targets():
            if target.get("type") == "page" and (target.get("url") or "") in ("about:blank", "chrome://newtab/"):
                bws.send(json.dumps({
                    "id": n,
                    "method": "Target.closeTarget",
                    "params": {"targetId": target["id"]},
                }))
                n += 1
        bws.close()
    except Exception:
        pass
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
