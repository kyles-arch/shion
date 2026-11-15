//! Discord REST API istemcisi (rate-limit farkinda).

use base64::Engine;
use reqwest::{Client, Method};
use serde_json::{json, Value};
use std::time::Duration;

pub const UA: &str = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";
const BASE: &str = "https://discord.com/api/v9";

/// Gateway IDENTIFY ve X-Super-Properties icin istemci bilgileri.
pub fn props() -> Value {
    json!({
        "os": "Windows",
        "browser": "Chrome",
        "device": "",
        "system_locale": "tr-TR",
        "browser_user_agent": UA,
        "browser_version": "131.0.0.0",
        "os_version": "10",
        "referrer": "",
        "referring_domain": "",
        "referrer_current": "",
        "referring_domain_current": "",
        "release_channel": "stable",
        "client_build_number": 355000,
        "client_event_source": null
    })
}

pub struct Api {
    client: Client,
    super_props: String,
}

impl Api {
    pub fn new() -> Self {
        let client = Client::builder()
            .user_agent(UA)
            .timeout(Duration::from_secs(20))
            .pool_max_idle_per_host(4)
            .build()
            .expect("http client");
        let super_props = base64::engine::general_purpose::STANDARD.encode(props().to_string());
        Self { client, super_props }
    }

    fn builder(&self, token: &str, method: Method, path: &str) -> reqwest::RequestBuilder {
        self.client
            .request(method, format!("{BASE}{path}"))
            .header("Authorization", token)
            .header("X-Super-Properties", &self.super_props)
            .header("X-Discord-Locale", "tr")
            .header("X-Discord-Timezone", "Europe/Istanbul")
    }

    /// Yanit -> Ok(Some(json)) | 429 ise Ok(None) (bekledikten sonra) | hata
    async fn handle(res: reqwest::Response) -> Result<Option<Value>, String> {
        let status = res.status().as_u16();
        if status == 429 {
            let v: Value = res.json().await.unwrap_or_default();
            let wait = v["retry_after"].as_f64().unwrap_or(1.0).clamp(0.1, 15.0);
            tokio::time::sleep(Duration::from_secs_f64(wait)).await;
            return Ok(None);
        }
        if status == 204 {
            return Ok(Some(Value::Null));
        }
        let text = res.text().await.map_err(|e| e.to_string())?;
        if !(200..300).contains(&status) {
            let msg = serde_json::from_str::<Value>(&text)
                .ok()
                .and_then(|v| v["message"].as_str().map(String::from))
                .unwrap_or(text);
            return Err(format!("{status} {msg}"));
        }
        serde_json::from_str(&text).map(Some).map_err(|e| e.to_string())
    }

    pub async fn req(&self, token: &str, method: Method, path: &str, body: Option<Value>) -> Result<Value, String> {
        for _ in 0..4 {
            let mut rb = self.builder(token, method.clone(), path);
            if let Some(b) = &body {
                rb = rb.json(b);
            }
            let res = rb.send().await.map_err(|e| format!("Ag hatasi: {e}"))?;
            if let Some(v) = Self::handle(res).await? {
                return Ok(v);
            }
        }
        Err("Rate limit asildi, biraz bekle".into())
    }

    /// Dosyali mesaj (multipart). files: (dosya adi, icerik)
    pub async fn upload(&self, token: &str, path: &str, payload: &Value, files: &[(String, Vec<u8>)]) -> Result<Value, String> {
        for _ in 0..3 {
            let mut form = reqwest::multipart::Form::new().text("payload_json", payload.to_string());
            for (i, (name, data)) in files.iter().enumerate() {
                let part = reqwest::multipart::Part::bytes(data.clone()).file_name(name.clone());
                form = form.part(format!("files[{i}]"), part);
            }
            let res = self
                .builder(token, Method::POST, path)
                .timeout(Duration::from_secs(300))
                .multipart(form)
                .send()
                .await
                .map_err(|e| format!("Yukleme hatasi: {e}"))?;
            if let Some(v) = Self::handle(res).await? {
                return Ok(v);
            }
        }
        Err("Rate limit asildi, biraz bekle".into())
    }

    pub async fn get(&self, token: &str, path: &str) -> Result<Value, String> {
        self.req(token, Method::GET, path, None).await
    }

    /// Discord disi, kimlik bilgisi gondermeyen GET (ceviri vb.)
    pub async fn external(&self, url: &str, query: &[(&str, &str)]) -> Result<Value, String> {
        let res = self.client.get(url).query(query).send().await.map_err(|e| format!("Ag hatasi: {e}"))?;
        if !res.status().is_success() {
            return Err(format!("{}", res.status()));
        }
        res.json().await.map_err(|e| e.to_string())
    }
}

/// URL sorgu/parca kodlamasi (RFC 3986 unreserved disindakiler %XX)
pub fn enc(s: &str) -> String {
    s.bytes()
        .map(|b| if b.is_ascii_alphanumeric() || b"-_.~".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") })
        .collect()
}
