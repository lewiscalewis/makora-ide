use serde_json::Value;
use specta::Type;

#[derive(Clone, serde::Serialize, Type)]
#[serde(rename_all = "camelCase")]
pub struct BalanceInfo {
    pub provider: String,
    pub currency: String,
    pub amount: f64,
}

pub async fn fetch_balance(
    provider: &str,
    base_url: &str,
    api_key: &str,
) -> Result<Option<BalanceInfo>, String> {
    let client = reqwest::Client::new();
    match provider {
        "deepseek" => {
            let url = format!("{}/user/balance", base_url.trim_end_matches('/'));
            let resp = client
                .get(&url)
                .bearer_auth(api_key)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Ok(None);
            }
            let body: Value = resp.json().await.map_err(|e| e.to_string())?;
            let first = body
                .get("balance_infos")
                .and_then(|b| b.as_array())
                .and_then(|a| a.first());
            let amount = first
                .and_then(|f| f.get("total_balance"))
                .and_then(|x| x.as_str())
                .and_then(|s| s.parse::<f64>().ok())
                .or_else(|| first.and_then(|f| f.get("total_balance")).and_then(|x| x.as_f64()));
            let currency = first
                .and_then(|f| f.get("currency"))
                .and_then(|c| c.as_str())
                .unwrap_or("USD")
                .to_string();
            Ok(amount.map(|a| BalanceInfo {
                provider: provider.to_string(),
                currency,
                amount: a,
            }))
        }
        "openrouter" => {
            let url = "https://openrouter.ai/api/v1/credits";
            let resp = client
                .get(url)
                .bearer_auth(api_key)
                .send()
                .await
                .map_err(|e| e.to_string())?;
            if !resp.status().is_success() {
                return Ok(None);
            }
            let body: Value = resp.json().await.map_err(|e| e.to_string())?;
            let total = body
                .pointer("/data/total_credits")
                .and_then(|x| x.as_f64())
                .or_else(|| {
                    body.pointer("/data/total_credits")
                        .and_then(|x| x.as_str())
                        .and_then(|s| s.parse::<f64>().ok())
                });
            Ok(total.map(|t| BalanceInfo {
                provider: provider.to_string(),
                currency: "USD".into(),
                amount: t,
            }))
        }
        _ => Ok(None),
    }
}
