//! PrimeBrush Rust 核心：与 Python `PrimeBrushPlugin` 对齐的迁移骨架。
//!
//! 完整渲染管线尚未接入；后续可将几何/绘图热路径迁入此 crate 并编译为 WASM。

use serde_json::Value;

/// 与 Python 侧 `parse_primebrush` / `render` 契约对齐：可 JSON 序列化的文档载荷。
pub type DiagramPayload = Value;

#[derive(Debug, thiserror::Error)]
pub enum PrimeBrushError {
    #[error("unknown diagram type: {0}")]
    UnknownType(String),
    #[error("serialization: {0}")]
    Serde(#[from] serde_json::Error),
}

/// Rust 侧插件接口（与 `plugin_base.PrimeBrushPlugin` 对应）。
pub trait PrimeBrushPlugin: Send + Sync {
    fn type_names(&self) -> &'static [&'static str];
    fn render_svg(&self, doc: &DiagramPayload, seed: u64) -> Result<String, PrimeBrushError>;
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    struct EchoPlugin;

    impl PrimeBrushPlugin for EchoPlugin {
        fn type_names(&self) -> &'static [&'static str] {
            &["test_diagram"]
        }

        fn render_svg(&self, doc: &DiagramPayload, seed: u64) -> Result<String, PrimeBrushError> {
            Ok(format!(
                "<svg data-seed=\"{seed}\"><title>{}</title></svg>",
                doc["title"].as_str().unwrap_or_default()
            ))
        }
    }

    #[test]
    fn plugin_contract_reports_types_and_renders_deterministically() {
        let plugin = EchoPlugin;
        let payload = json!({"title": "triangle"});

        assert_eq!(plugin.type_names(), &["test_diagram"]);
        assert_eq!(
            plugin.render_svg(&payload, 42).unwrap(),
            "<svg data-seed=\"42\"><title>triangle</title></svg>"
        );
    }

    #[test]
    fn errors_have_stable_user_facing_messages() {
        let unknown = PrimeBrushError::UnknownType("unsupported".to_owned());
        assert_eq!(unknown.to_string(), "unknown diagram type: unsupported");

        let serde_error = serde_json::from_str::<DiagramPayload>("{").unwrap_err();
        let wrapped = PrimeBrushError::from(serde_error);
        assert!(wrapped.to_string().starts_with("serialization:"));
    }
}
