# Refresh Tracker

Sayfa yenilemelerini otomatik olarak zaman damgasıyla kaydeden, otomatik yenilemelerde konsol loglarını yakalayan tarayıcı uzantısı.

Test ortamlarında kendiliğinden gerçekleşen sayfa yenilemelerini tespit etmek ve nedenini araştırmak için geliştirilmiştir.

---

## Özellikler

- Tüm sayfa yenilemelerini saat, tarih ve milisaniye hassasiyetiyle kaydeder
- Yenilemenin türünü ayırt eder: kullanıcı kaynaklı (F5), JS yönlendirmesi, sunucu yönlendirmesi
- Otomatik yenilemelerde yenilemeden önceki **1 saatlik konsol loglarını** yakalar (`console.log/warn/error`, yakalanmamış JS hataları, unhandled promise rejection)
- URL filtresi ile yalnızca belirli bir test ortamını izler
- Kayıtları CSV olarak dışa aktarır
- Chrome (MV3) ve Firefox / Zen Browser (MV2) destekler

---

## Ekran Görüntüsü

```
┌─────────────────────────────────────────────────┐
│ Refresh Tracker                            [3]  │
├─────────────────────────────────────────────────┤
│ [URL filtresi...]  [Kaydet]  [CSV]  [Temizle]   │
├─────────────────────────────────────────────────┤
│ Tümü │ Otomatik │ Yenilemeler │ Yönlendirmeler  │
├─────────────────────────────────────────────────┤
│ ▌ 18:42:31.204  JS YÖN.  CONSOLE 3 hata / 12 l │
│   testportal.doctorin.app/dashboard             │
│   ↳ [konsola tıkla → loglar açılır]             │
│ ▌ 18:39:05.881  YENİLEME                        │
│   testportal.doctorin.app/dashboard             │
└─────────────────────────────────────────────────┘
```

---

## Kurulum

### Gereksinimler

- Python 3 (paket oluşturmak için)
- Chrome / Chromium / Brave / Edge **veya** Firefox / Zen Browser

### 1. Depoyu klonlayın

```bash
git clone https://github.com/LURIDD/refresh-tracker.git
cd refresh-tracker
```

### 2. Paketleri oluşturun

```bash
python3 build.py
```

Çıktı:
```
dist/chrome/                        ← Chrome için klasör
dist/refresh-tracker-firefox.xpi   ← Firefox / Zen Browser için
```

---

## Tarayıcıya Yükleme

### Chrome / Chromium / Brave / Edge

1. `chrome://extensions/` adresine gidin
2. Sağ üstten **Geliştirici modu**'nu açın
3. **"Load unpacked"** butonuna tıklayın
4. `dist/chrome/` klasörünü seçin

### Firefox / Zen Browser

**Ön hazırlık (bir kez yapılır):**

1. `about:config` adresine gidin
2. `xpinstall.signatures.required` ayarını bulun → `false` yapın

**Kurulum:**

1. `about:addons` adresine gidin
2. Dişli ikonuna tıklayın → **"Install Add-on From File..."**
3. `dist/refresh-tracker-firefox.xpi` dosyasını seçin
4. Çıkan izin penceresinde **"Add"** deyin

---

## Kullanım

1. Uzantıyı yükledikten sonra izlemek istediğiniz sayfaya gidin
2. Araç çubuğundaki ikona tıklayarak popup'ı açın
3. **URL Filtresi** alanına test ortamınızın adresini girin (örn. `testportal.doctorin.app`) ve **Kaydet**'e basın — böylece yalnızca o siteye ait olaylar kaydedilir
4. Sayfa her yenilendiğinde liste otomatik güncellenir, ikon üzerinde sayaç artar

### Konsol loglarını görme

Otomatik yenilemelerde (JS yönlendirmesi, meta refresh vb.) kayıt satırına tıklayarak o yenilemeden önceki konsol loglarını görebilirsiniz.

### CSV dışa aktarma

**CSV** butonuna basarak tüm kayıtları (konsol logları dahil) Excel'de açılabilir formatta indirebilirsiniz.

---

## Güncelleme

Kaynak kodda değişiklik yaptıktan sonra:

```bash
python3 build.py
```

- **Chrome:** `chrome://extensions/` sayfasında uzantının yenile ikonuna basın
- **Firefox:** Eklentiyi kaldırıp yeni `.xpi`'yi yeniden yükleyin

---

## Proje Yapısı

```
refresh-tracker/
├── src/
│   ├── background.js     # Arka plan servisi — olay dinleme, veri saklama
│   ├── content.js        # Her sayfada çalışır — navigasyon tespiti
│   ├── injected.js       # Sayfa main world'e enjekte edilir — konsol yakalama
│   ├── popup.html        # Uzantı popup arayüzü
│   ├── popup.js          # Popup mantığı
│   └── icons/
├── manifests/
│   ├── manifest.chrome.json   # Chrome MV3
│   └── manifest.firefox.json  # Firefox MV2
├── build.py              # Paket oluşturucu
└── .gitignore
```

---

## Lisans

MIT
