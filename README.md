# Shion — hafif Discord istemcisi (Rust + Tauri)

Electron yerine **Tauri 2** (sistemdeki WebView2) + **Rust** arka uç. Gateway (WebSocket), REST, izin hesaplama ve mesaj önbelleği Rust'ta çalışır; arayüz framework'süz düz HTML/CSS/JS'tir (bundler yok, node_modules arayüze girmez).

## Özellikler
- **Gizli kanallar** — görme iznin olmayan kanallar 🔒 ile listelenir; tıklayınca konu, son mesaj zamanı, kanalı görebilen/engellenen roller gösterilir.
- **Silinen mesajlar** — uygulama açıkken silinen mesajlar kırmızı olarak sohbette kalır + 🗑 menüsünde **kalıcı** kayıt (diske yazılır, yeniden açınca durur; 1500 mesaja kadar).
- **Düzenleme geçmişi** — düzenlenen mesajların eski halleri üstü çizili gösterilir.
- **11 tema** (Gece, Klasik Koyu, AMOLED, Nord, Dracula, Mocha, Rosé, Tokyo Gecesi, Neon, Sakura, Açık) + vurgu rengi + yazı boyutu + kompakt mod + **özel CSS**.
- Markdown, emoji, sticker, ek/resim/video, embed, yanıt, düzenleme (↑ tuşu), silme, okunmamış/etiket rozetleri.
- **Dosya yükleme** — ＋ butonu, Ctrl+V ile resim yapıştırma, sürükle-bırak (10 dosyaya kadar).
- **Forum kanalları** — gönderi listesi, arama, yeni gönderi açma; **thread'ler** kanalların altında listelenir.
- **Üye listesi** — sağ panel; rol grupları, çevrimiçi durumu, rol rengi, aktivite/özel durum.
- **Tepkiler**, **emoji seçici** (sunucu emojileri dahil), **"yazıyor…" göstergesi**.
- Optimizasyon: sadece açık kanalın olayları arayüze gönderilir, diğerleri tek satırlık "okunmamış" sinyali; DOM en fazla ~300 mesaj tutar; release derlemesi LTO + `opt-level="s"` + strip.

- **Sesli sohbet** — sunucu ses kanalları ve DM aramaları (arama başlat/çaldır, gelen aramayı kabul/ret). Rust'ta: ses gateway v8, UDP + `aead_xchacha20_poly1305_rtpsize`, **DAVE uçtan uca şifreleme** (`davey`), Opus, mikrofon/hoparlör seçimi, hassasiyet (VAD), çıkış sesi, sessiz/sağır, konuşan kişide yeşil halka.
- **Sunucu klasörleri** — sunucuyu başka bir sunucunun üstüne sürükle = klasör; kenarlarına bırak = sırala; sağ tık ile ad/renk/taşı/dağıt. Discord'daki klasörlerin varsa ilk açılışta alınır.
- **Durum seçici** (Çevrimiçi/Boşta/Rahatsız Etmeyin/Görünmez) ve **masaüstü bildirimleri**.

- **Otomatik kategorize** — sunucular adlarına ve kanal adlarına göre Oyun / Yazılım / Müzik / Anime / Eğitim / Kripto / Sanat / Arkadaşlar / Topluluk klasörlerine ayrılır (önizleyip düzeltebilirsin). Ayarlar → Hesap.
- **Profil düzenleyici** — görünen ad, avatar, hakkımda, zamirler, banner rengi, özel durum; canlı önizleme. Shion'a özel **profil efektleri** (Aurora, Neon, Hologram, Alev).
- **Profil kartları** — mesaj yazarına / üyeye / sesteki kişiye tıkla: bio, ortak sunucular, "Mesaj gönder".
- **Ctrl+K hızlı geçiş**, **Aurora** ve **Cam** temaları, yükleme ekranı, mesaj animasyonları.

- **Okunmamışlar** — Discord'un okuma durumu kullanılır: kapatıp açınca okunmamış/etiket rozetleri doğru gelir, açtığın kanal okundu işaretlenir (diğer cihazlarla senkron).
- **Arkadaşlar** — Çevrimiçi / Tümü / Bekleyen / Engellenen sekmeleri, oynadığı oyun ve özel durum, istek kabul/ret, kullanıcı adıyla arkadaş ekleme.
- **Mesaj arama** (🔍 veya Ctrl+F) ve **sabitlenmiş mesajlar** (📌) — sonuca tıklayınca o mesaja atlar.
- **Sessize alma** — sunucu/kanal/DM'ye sağ tık → sessize al (Discord'a da kaydedilir, bildirim gelmez).
- **Bas-konuş** — sistem genelinde kısayol (oyun içindeyken de çalışır); sadece seste iken tuşu kaydeder.
- **Tepsi + Windows ile başlat** — kapatınca arka planda çalışır; açılışta küçültülmüş başlar.
- **Token şifreleme** — kayıtlı token Windows DPAPI ile şifrelenir (eski düz metin kayıt otomatik taşınır).
- **Hayalet yazma** 👻, **yer imleri** 🔖, **yerel takma adlar** 🏷, **mesaj çevirisi** 🌐, **GIF seçici**, **sesli kanalların metin sohbeti** (kanal satırındaki 💬).

- **Kamera ve ekran paylaşımı (Go Live)** — ses panelindeki Kamera / Ekran düğmeleri; başkasının yayınını izlemek için ses listesindeki **CANLI** rozetine tıkla. Görüntüler sohbetin üstünde ızgarada (⛶ odakla, çift tık tam ekran).
  Görüntü WebView2'nin **WebCodecs**'i ile donanım hızlandırmalı H264 olarak kodlanır/çözülür; Rust tarafı RTP paketleme (FU-A/STAP-A), DAVE uçtan uca şifreleme, PLI anahtar kare istekleri ve Discord'un yayın sinyalleşmesini (op 12/15/18-22) yapar. Ek yerel kütüphane yok.

- **Yayın sesi** — ekran paylaşırken sistem sesi de gönderilir (Opus stereo 128 kbps); izlerken yayıncının sesi çalınır.
- **Davetler** — mesajlardaki discord.gg linkleri kart olarak gösterilir (sunucu adı, üye/çevrimiçi sayısı, **Katıl**); sol çubuktaki **＋** ile kodla katılma; sunucu menüsünden **davet oluştur** ve **sunucudan ayrıl**.
- **Slash komutları** — kutuya `/` yaz: sunucudaki botların komutları listelenir (Tab/↑↓ ile seç), seçenekler `ad:değer` biçiminde, alt komutlar dahil.
- **Anketler** — mesajdaki anketler oy oranlarıyla gösterilir, tıklayarak oy ver/geri al, kendi anketini bitir; 📊 ile anket oluştur (süre, çoklu seçim).
- **Sesli mesajlar** — 🎤 ile kaydet, Rust tarafında Ogg/Opus'a çevrilip dalga formuyla gönderilir; gelenler dalga formlu oynatıcıda çalınır.
- **Moderasyon** — yetkin varsa üyeye sağ tık: zaman aşımı, at, yasakla (sebep ile denetim kaydına), takma ad, rol düzenle (senden üstteki roller kilitli); mesajlarda sabitle/kaldır ve başkasının mesajını silme.

- **Gürültü engelleme** 🎧 — mikrofon sesi RNNoise (`nnnoiseless`, saf Rust) ile temizlenir; cihazında çalışır, ayarlardan kapatılabilir.
- **Çoklu hesap** 👥 — "Beni hatırla" ile giriş yapılan hesaplar listelenir; profil menüsünden tek tıkla geçiş / hesap ekleme. Token'lar DPAPI ile şifreli.
- **FakeNitro** ✨ — Nitro yoksa başka sunucuların ve animasyonlu emojiler, çıkartmalar bağlantı olarak gönderilir; emoji seçicide tüm sunucuların emojileri, 🗒️ ile çıkartma seçici.
- **Gizli profil bilgileri** 🕵 — hesap açılış tarihi/saati ve yaşı, sunucuya katılım, Nitro/takviye tarihleri, rozetler, bağlı hesaplar, ID; avatar/banner indirme.
- **Ses kanalı kaydı** — sunucu menüsü → kimin hangi ses kanalına girip çıktığı; bulunduğun kanala giren/çıkan için bildirim.
- **Arkadaş takibi** — profil kartından 🔔 Takip et: çevrimiçi olunca / oyuna girince bildirim. Arkadaşların isim ve avatar değişiklikleri yerel olarak kaydedilir.
- **Anahtar kelime bildirimleri** 🔔, **sessiz mesaj** (`@silent` ile başla), **zamanlanmış mesaj** ⏰, **kanal başına taslak**.
- **Oyun aktivitesi** 🎮 — açık oyun Discord'un oyun listesine göre algılanır, profilinde "Oynuyor" olarak görünür.
- **Kanal yedekleme** — kanala sağ tık → tüm geçmiş HTML veya JSON olarak `İndirilenler\Shion` klasörüne.
- **Medya indirme** — mesajdaki resim/emoji/çıkartmaya sağ tık → İndir / bağlantıyı kopyala.
- **Kişi başı ses seviyesi** — sesteki kişiye sağ tık → %0–200 ses ya da yerel susturma (hatırlanır).
- **Mikrofon testi** — Ayarlar → seviye göstergesi + hassasiyet çizgisi, istersen kendi sesini duy.
- **Otomatik güncelleme** — yeni sürümler [GitHub Releases](https://github.com/kyles-arch/shion/releases)'tan imzalı olarak iner; Shion açılışta denetler, tek tıkla kurar.

### Ekran paylaşımı (0.2.0 düzeltmeleri)
- İzlemeye başlayınca yayıncıdan hemen anahtar kare istenir (önceden siyah ekranda kalabiliyordu).
- Sırası karışan paketler artık bekleniyor (önceden her karışıklıkta kare atılıp görüntü takılıyordu).
- 1440p / 4K / ultra geniş ekranlar seçilen kaliteye (720p, 1080p30, 1080p60) küçültülüyor; önceden kodlayıcı hiç başlamıyordu.
- Yayın sesi Windows'un "bu uygulama hariç" yakalamasıyla alınıyor: sesli sohbet yayına yankı olarak gitmiyor.
- Kanalda değilken CANLI'ya basınca önce bağlanıp yayını otomatik açıyor.

**Bilinen sınırlar:** ses/kamera/yayın Discord protokolüne göre yazıldı ama gerçek hesapla henüz denenmedi. Davetle katılırken Discord captcha isterse Shion bunu çözemez; daveti tarayıcıda açmayı önerir. Exe kod imzalama sertifikasıyla imzalı olmadığı için ilk kurulumda Windows SmartScreen uyarısı çıkar (güncellemeler ise ayrı bir anahtarla imzalı ve doğrulanıyor).

## Testler
```bash
cd src-tauri && cargo test          # 37 Rust birim testi (sıralama toleranslı H264 birleştirme, izinler, mesaj kaydı, okuma durumu, anket oyları, anahtar kelimeler, DPAPI, RTP şifreleme, H264 paketleme, RTCP, DAVE, Opus, Ogg/sesli mesaj, gürültü engelleme, oyun algılama, HTML yedek, yeniden örnekleme)
node tests/serve.mjs                # arayüzü sahte Discord verisiyle http://localhost:5174 adresinde açar
```
Tarayıcı konsolunda arayüz testleri (66 senaryo; güncelleme, mikrofon testi, kişi başı ses, ekran ölçekleme, çoklu hesap, FakeNitro, gizli profil, ses kaydı, taslak, zamanlama, yedekleme, davet, slash, anket, sesli mesaj kaydı, moderasyon ve WebCodecs ile gerçek H264 kodlama→çözme dahil): `await (await import('/__test/ui-tests.js')).run()`

## Derleme
Gerekenler: Node.js, [Rust](https://rustup.rs) (MSVC toolchain), Visual Studio C++ Build Tools, WebView2 (Windows 11'de hazır).

```bash
npm install
npm run dev      # geliştirme modunda aç
npm run build    # src-tauri/target/release/shion.exe + src-tauri/target/release/bundle/nsis/Shion_*_x64-setup.exe
```

## Uyarı
Üçüncü parti istemciler Discord Hizmet Şartları'na aykırıdır; hesabın kısıtlanabilir veya banlanabilir. Token `%APPDATA%\dev.shion.client\session.dat` içinde DPAPI ile şifreli saklanır (sadece bu Windows kullanıcısı çözebilir; "Beni hatırla" kapalıysa hiç saklanmaz). Çeviri için mesaj metni Google Çeviri'ye gönderilir (sadece 🌐'ye bastığında).

## Yeni sürüm yayınlama
1. `src-tauri/tauri.conf.json`, `src-tauri/Cargo.toml`, `package.json` içindeki sürümü artır.
2. İmza anahtarıyla derle (anahtar depoda değil, `%USERPROFILE%\.tauri\shion-updater.key`):
   ```powershell
   $env:TAURI_SIGNING_PRIVATE_KEY = Get-Content "$env:USERPROFILE\.tauri\shion-updater.key" -Raw
   $env:TAURI_SIGNING_PRIVATE_KEY_PASSWORD = ""
   npm run build
   ```
3. `node scripts/latest-json.mjs` → `latest.json` üretir.
4. GitHub'da `vX.Y.Z` sürümü oluştur; `Shion_X.Y.Z_x64-setup.exe`, `.sig` dosyası ve `latest.json` ekle. Açık olan tüm Shion'lar güncellemeyi görür.

⚠ İmza anahtarını kaybedersen eski kurulumlar yeni sürümleri kabul etmez — `shion-updater.key` dosyasını yedekle.
