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

**Bilinen sınırlar:** ses/kamera/yayın Discord protokolüne göre yazıldı ama gerçek hesapla henüz denenmedi. Davetle katılırken Discord captcha isterse Shion bunu çözemez; daveti tarayıcıda açmayı önerir. Otomatik güncelleme yok (bir güncelleme sunucusu/GitHub deposu gerekir) ve exe imzasız olduğu için Windows SmartScreen uyarısı çıkar.

## Testler
```bash
cd src-tauri && cargo test          # 31 Rust birim testi (izinler, mesaj kaydı, okuma durumu, anket oyları, DPAPI, RTP şifreleme, H264 paketleme, RTCP, DAVE, Opus, Ogg/sesli mesaj, yeniden örnekleme)
node tests/serve.mjs                # arayüzü sahte Discord verisiyle http://localhost:5174 adresinde açar
```
Tarayıcı konsolunda arayüz testleri (51 senaryo; davet, slash, anket, sesli mesaj kaydı, moderasyon ve WebCodecs ile gerçek H264 kodlama→çözme dahil): `await (await import('/__test/ui-tests.js')).run()`

## Derleme
Gerekenler: Node.js, [Rust](https://rustup.rs) (MSVC toolchain), Visual Studio C++ Build Tools, WebView2 (Windows 11'de hazır).

```bash
npm install
npm run dev      # geliştirme modunda aç
npm run build    # src-tauri/target/release/shion.exe + src-tauri/target/release/bundle/nsis/Shion_*_x64-setup.exe
```

## Uyarı
Üçüncü parti istemciler Discord Hizmet Şartları'na aykırıdır; hesabın kısıtlanabilir veya banlanabilir. Token `%APPDATA%\dev.shion.client\session.dat` içinde DPAPI ile şifreli saklanır (sadece bu Windows kullanıcısı çözebilir; "Beni hatırla" kapalıysa hiç saklanmaz). Çeviri için mesaj metni Google Çeviri'ye gönderilir (sadece 🌐'ye bastığında).
