#!/usr/bin/env python3
"""
Refresh Tracker - Build Script
Kullanım: python3 build.py
Çıktı:    dist/chrome/          ← Chrome: Load unpacked ile bu klasörü göster
          dist/refresh-tracker-firefox.xpi  ← Firefox/Zen: doğrudan kur
"""

import zipfile
import shutil
import os
import json

SRC = "src"
MANIFESTS = "manifests"
DIST = "dist"
CHROME_DIR = os.path.join(DIST, "chrome")


def build_chrome_folder():
    """Chrome için hazır klasör oluşturur (Load unpacked ile doğrudan yüklenebilir)."""
    if os.path.exists(CHROME_DIR):
        shutil.rmtree(CHROME_DIR)
    os.makedirs(CHROME_DIR)

    # manifest.json
    shutil.copy(f"{MANIFESTS}/manifest.chrome.json", os.path.join(CHROME_DIR, "manifest.json"))

    # src dosyaları
    for root, _, files in os.walk(SRC):
        for file in files:
            src_path = os.path.join(root, file)
            rel = os.path.relpath(src_path, SRC)
            dst = os.path.join(CHROME_DIR, rel)
            os.makedirs(os.path.dirname(dst), exist_ok=True)
            shutil.copy(src_path, dst)

    size_kb = sum(
        os.path.getsize(os.path.join(r, f))
        for r, _, fs in os.walk(CHROME_DIR) for f in fs
    ) / 1024
    print(f"  [OK] {CHROME_DIR}/   ({size_kb:.1f} KB)  ← Chrome'a bu klasörü göster")


def build_xpi():
    """Firefox/Zen Browser için .xpi paketi oluşturur."""
    output = os.path.join(DIST, "refresh-tracker-firefox.xpi")
    with zipfile.ZipFile(output, "w", zipfile.ZIP_DEFLATED) as zf:
        zf.write(f"{MANIFESTS}/manifest.firefox.json", "manifest.json")
        for root, _, files in os.walk(SRC):
            for file in files:
                filepath = os.path.join(root, file)
                arcname = os.path.relpath(filepath, SRC)
                zf.write(filepath, arcname)

    size_kb = os.path.getsize(output) / 1024
    print(f"  [OK] {output}  ({size_kb:.1f} KB)  ← Firefox/Zen'e bu dosyayı kur")


def main():
    os.makedirs(DIST, exist_ok=True)

    with open(f"{MANIFESTS}/manifest.chrome.json") as f:
        version = json.load(f).get("version", "?")

    print(f"\nRefresh Tracker v{version} - Build\n{'─'*40}")

    print("\n  Chrome / Chromium / Brave / Edge")
    build_chrome_folder()

    print("\n  Firefox / Zen Browser")
    build_xpi()

    print(f"\n{'─'*40}")
    print("Chrome kurulum:")
    print("  1. chrome://extensions/ → Geliştirici modu AÇ")
    print("  2. 'Load unpacked' → dist/chrome/ klasörünü seç")
    print()
    print("Firefox/Zen kurulum:")
    print("  1. about:config → xpinstall.signatures.required → false")
    print("  2. about:addons → Dişli → 'Install Add-on From File...'")
    print("  3. dist/refresh-tracker-firefox.xpi dosyasını seç\n")


if __name__ == "__main__":
    main()
