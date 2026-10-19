# Malzeme Takip — fabrika stok takibi

Girişim Elektrik / Europower için fabrika deposundaki malzemelerin **giriş ve sevkiyatını canlı** izleyen, kendi sunucunuzda çalışan web uygulaması. International Desk ile aynı tasarım ve aynı altyapı (Node.js + SQLite, kendi giriş sistemi, kendi veritabanı).

**Neler yapar**

- **Malzeme kartları** — kod, ad, birim, kategori, konum (depo/raf), açıklama ve elle belirlenen **minimum stok limiti**.
- **Giriş / sevkiyat / düzeltme fişleri** — her belge numaralandırılır (`GRS-2026-00001`, `SVK-2026-00001`, `DZL-2026-00001`), bir veya daha fazla malzeme satırı taşır ve **kimin talimat / sipariş verdiğini**, kimin kaydettiğini, tedarikçi veya teslimat yerini, irsaliye numarasını ve araç plakasını tutar. Satırlar kaydedildikten sonra değiştirilemez; hatalı belge yönetici tarafından iptal edilir (stok etkisi geri alınır, PDF'e "İPTAL" damgası basılır).
- **Canlı stok** — açık olan bütün ekranlar WebSocket ile anında güncellenir; stok her zaman belgelerden hesaplanır.
- **Alarm** — stok, kartındaki limitin altına düşünce alarm açılır: uygulamada kırmızı şerit ve zil, telefona anlık bildirim (VAPID anahtarları girilmişse) ve e-posta (SMTP girilmişse; ekip üyeleri ve ek alıcılar). Stok limitin üstüne çıkınca alarm kendiliğinden kapanır.
- **PDF fişi** — her belge için A4 PDF (Girişim başlığı, satırlar, önceki/kalan stok, imza kutuları); istenildiği an açılır veya indirilir.
- **Excel/CSV dışa aktarım** — stok listesi ve filtrelenmiş hareket dökümü.
- **Ekip** — e-posta/şifre ile giriş, davet bağlantısı, roller: yönetici (ekip, ayarlar, iptal), kullanıcı (belge ve kart girer), görüntüleyici.
- Telefona **Ana Ekrana Ekle** ile kurulur; koyu tema desteklenir.

## Gereksinimler

- **Node.js 22.13 veya üstü** (24 LTS önerilir) — ya da Docker.
- Dışarıdan erişim için bir alan adı ve HTTPS (Railway bunu kendisi sağlar).

## Railway'de kurulum (önerilen)

1. Bu klasörü özel bir GitHub deposuna koyun ve Railway'de depodan bir servis oluşturun (Dockerfile otomatik tanınır).
2. Servise bir **Volume** ekleyin, bağlama yolu `/data`. (Volume yoksa veriler her dağıtımda silinir; uygulama bunu kurulum ekranında uyarır.)
3. **Variables**: `SESSION_SECRET=<uzun rastgele metin>`, isteğe bağlı `ALLOWED_EMAIL_DOMAINS=girisimelektrik.com,europowerenerji.com.tr`.
4. **Settings → Networking → Generate Domain** (hedef port 3000), ardından `BASE_URL=https://<o alan adı>` değişkenini ekleyin.
5. Adresi açın: ilk ekran **ilk yöneticiyi** oluşturur; o da ekibi Ekip panelinden davet eder.

## Kendi sunucunuzda kurulum

```bash
cd /opt/malzeme-takip
npm install --omit=dev
cp .env.example .env     # BASE_URL ve SESSION_SECRET'ı doldurun
npm start                # "http://localhost:3000 adresinde dinliyor"
```

HTTPS için önüne Caddy koyun (`deploy/Caddyfile`), ya da `docker compose` ile çalıştırın.

## Bildirimler

- **Anlık bildirim (telefon/bilgisayar):** bir kez `node -e "console.log(require('web-push').generateVAPIDKeys())"` çalıştırıp `VAPID_PUBLIC_KEY` ve `VAPID_PRIVATE_KEY` değişkenlerini girin. Herkes kendi cihazında Ayarlar → *Bildirimleri aç* der. iPhone/iPad'de uygulama önce Ana Ekrana eklenmelidir.
- **E-posta:** `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `MAIL_FROM` değişkenleri. Davetler ve şifre sıfırlama da e-posta ile gider; SMTP yoksa davet bağlantısı Ekip panelinde gösterilir.
- Yönetici ayarlarında: ek alarm alıcıları, alarm bildiriminin herkese mi yöneticilere mi gideceği, eksi stok izni ve PDF başlığındaki şirket bilgisi.

## Veri ve yedek

Her şey tek bir SQLite dosyasındadır: `DATA_DIR/malzeme.sqlite` (Railway'de `/data`). Ayarlar → *Veritabanı yedeği* tutarlı bir kopya indirir. Geri yüklemek için uygulamayı durdurup dosyayı değiştirin.

## Yapı

```
server.js        HTTP API, WebSocket, giriş/davet, alarm değerlendirmesi
lib/db.js        SQLite şeması ve depo (malzeme, belge, satır, alarm, etkinlik)
lib/pdf.js       PDF fişi (pdfkit, gömülü Inter yazı tipi)
lib/mail.js      SMTP e-postaları (davet, sıfırlama, alarm)
lib/push.js      Web Push
public/          arayüz (app.js, styles.css, login.html, PWA dosyaları)
```
