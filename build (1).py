#!/usr/bin/env python3
"""Build self-contained single-file HTML dashboards for SAERS."""
import re

with open('styles.css') as f: CSS = f.read()
with open('state.js') as f: STATE = f.read()
with open('ui.js') as f: UI = f.read()
with open('bystander.js') as f: BYSTANDER = f.read()
with open('driver.js') as f: DRIVER = f.read()
with open('control.js') as f: CONTROL = f.read()

HEAD = """<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{TITLE}</title>
<link rel="stylesheet" href="https://unpkg.com/leaflet@1.9.4/dist/leaflet.css">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&family=JetBrains+Mono:wght@500&display=swap" rel="stylesheet">
<style>
"""

FOOT = """
</style>
</head>
<body>
<div class="app" id="app"></div>
<script src="https://unpkg.com/leaflet@1.9.4/dist/leaflet.js"></script>
<script>
"""

CLOSE = """
</script>
</body>
</html>
"""

def build(title, dash_js, filename):
    html = HEAD.replace('{TITLE}', title) + CSS + FOOT + STATE + "\n" + UI + "\n" + dash_js + CLOSE
    with open(filename, 'w') as f:
        f.write(html)
    print(f"Wrote {filename} ({len(html)} bytes)")

build("SAERS · Bystander Dashboard", BYSTANDER, "index.html")
build("SAERS · Ambulance Driver Dashboard", DRIVER, "driver.html")
build("SAERS · Control Room Dashboard", CONTROL, "control.html")
print("Done.")
