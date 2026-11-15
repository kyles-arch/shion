//! Discord izin hesaplama (gizli kanallari bulmak icin).

use crate::store::Guild;
use serde_json::Value;

pub const CREATE_INVITE: u64 = 1 << 0;
pub const ADMIN: u64 = 1 << 3;
pub const MANAGE_MESSAGES: u64 = 1 << 13;
pub const VIEW: u64 = 1 << 10;
pub const SEND: u64 = 1 << 11;

pub fn p(v: &Value) -> u64 {
    v.as_str().and_then(|s| s.parse().ok()).or_else(|| v.as_u64()).unwrap_or(0)
}

pub fn is_member_ow(o: &Value) -> bool {
    o["type"] == 1 || o["type"] == "member"
}

/// Sunucu genelindeki izinler.
pub fn base(g: &Guild, me: &str) -> u64 {
    if g.owner_id == me {
        return u64::MAX;
    }
    let mut perms = g.roles.get(&g.id).map(|r| p(&r["permissions"])).unwrap_or(0);
    for rid in &g.my_roles {
        if let Some(r) = g.roles.get(rid) {
            perms |= p(&r["permissions"]);
        }
    }
    if perms & ADMIN != 0 {
        return u64::MAX;
    }
    perms
}

/// Kanal overwrite'lari uygulanmis izinler.
pub fn channel(g: &Guild, ch: &Value, me: &str, base: u64) -> u64 {
    if base == u64::MAX {
        return base;
    }
    let mut perms = base;
    let Some(ows) = ch["permission_overwrites"].as_array() else { return perms };

    for o in ows {
        if o["id"].as_str() == Some(g.id.as_str()) {
            perms &= !p(&o["deny"]);
            perms |= p(&o["allow"]);
        }
    }
    let (mut allow, mut deny) = (0u64, 0u64);
    for o in ows {
        if is_member_ow(o) {
            continue;
        }
        if let Some(id) = o["id"].as_str() {
            if g.my_roles.iter().any(|r| r == id) {
                allow |= p(&o["allow"]);
                deny |= p(&o["deny"]);
            }
        }
    }
    perms &= !deny;
    perms |= allow;
    for o in ows {
        if is_member_ow(o) && o["id"].as_str() == Some(me) {
            perms &= !p(&o["deny"]);
            perms |= p(&o["allow"]);
        }
    }
    perms
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn guild() -> Guild {
        let mut g = Guild { id: "1".into(), owner_id: "999".into(), members_known: true, ..Default::default() };
        g.roles.insert("1".into(), json!({"id": "1", "permissions": (VIEW | SEND).to_string()}));
        g.roles.insert("10".into(), json!({"id": "10", "permissions": "0"}));
        g.roles.insert("20".into(), json!({"id": "20", "permissions": ADMIN.to_string()}));
        g
    }

    #[test]
    fn everyone_can_view_plain_channel() {
        let g = guild();
        let ch = json!({"permission_overwrites": []});
        let b = base(&g, "5");
        assert_ne!(channel(&g, &ch, "5", b) & VIEW, 0);
    }

    #[test]
    fn hidden_by_everyone_deny_but_role_allows() {
        let mut g = guild();
        let ch = json!({"permission_overwrites": [
            {"id": "1", "type": 0, "allow": "0", "deny": VIEW.to_string()},
            {"id": "10", "type": 0, "allow": VIEW.to_string(), "deny": "0"}
        ]});
        assert_eq!(channel(&g, &ch, "5", base(&g, "5")) & VIEW, 0, "rolsuz uye gorememeli");
        g.my_roles = vec!["10".into()];
        assert_ne!(channel(&g, &ch, "5", base(&g, "5")) & VIEW, 0, "rolu olan gorebilmeli");
    }

    #[test]
    fn member_overwrite_beats_role() {
        let mut g = guild();
        g.my_roles = vec!["10".into()];
        let ch = json!({"permission_overwrites": [
            {"id": "10", "type": "role", "allow": VIEW.to_string(), "deny": "0"},
            {"id": "5", "type": "member", "allow": "0", "deny": VIEW.to_string()}
        ]});
        assert_eq!(channel(&g, &ch, "5", base(&g, "5")) & VIEW, 0);
    }

    #[test]
    fn owner_and_admin_see_everything() {
        let mut g = guild();
        let ch = json!({"permission_overwrites": [{"id": "1", "type": 0, "allow": "0", "deny": VIEW.to_string()}]});
        assert_eq!(base(&g, "999"), u64::MAX);
        g.my_roles = vec!["20".into()];
        assert_ne!(channel(&g, &ch, "5", base(&g, "5")) & VIEW, 0);
    }
}
