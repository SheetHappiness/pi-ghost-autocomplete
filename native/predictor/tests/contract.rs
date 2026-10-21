use ghost_predictor::{Config, open};
#[test]
fn model_directory_is_required() {
    assert!(open(&Config::default()).is_err());
}
#[test]
fn missing_or_corrupt_assets_fail_closed() {
    let dir = std::env::temp_dir().join(format!("ghost-contract-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let config = Config {
        model_dir: Some(dir.clone()),
        ..Default::default()
    };
    assert!(open(&config).is_err());
    std::fs::write(dir.join("config.json"), "not json").unwrap();
    assert!(open(&config).is_err());
    std::fs::remove_file(dir.join("config.json")).unwrap();
    std::fs::remove_dir(dir).unwrap();
}
