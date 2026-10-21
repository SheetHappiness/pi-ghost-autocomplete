//! CPU-only SmolLM2 extraction from OMP. See vendor/omp/PROVENANCE.md.
use std::path::PathBuf;
pub mod prose;
pub mod smollm;
/// Editor state when ghost text is requested.
#[derive(Clone, Copy, Debug)]
pub struct Query<'a> {
    /// Prompt text before the word being typed (may span lines and contain
    /// code). The client may truncate it to a recent tail.
    pub before: &'a str,
    /// Letters of the current prose word typed so far (`[\p{L}\p{M}']+`),
    /// at least 2 characters; may already be a finished word.
    pub prefix: &'a str,
}

/// Ghost text to paint after [`Query::prefix`].
#[derive(Clone, Debug, PartialEq)]
pub struct Suggestion {
    /// Non-empty characters appended after the prefix.
    pub suffix: String,
    /// Engine-calibrated probability that `suffix` is exactly right.
    pub confidence: f32,
}

/// Construction options shared by every engine.
#[derive(Clone, Debug, Default)]
pub struct Config {
    /// Private directory the engine persists learned state into.
    pub state_dir: PathBuf,
    /// Directory holding downloaded model weights (`SmolLM2` only).
    pub model_dir: Option<PathBuf>,
    /// Minimum confidence [`Predictor::complete`] returns; `None` = the
    /// engine's tuned default. Evaluation passes `f32::NEG_INFINITY` to trace
    /// the full curve. `SmolLM`'s typed-past exclusion, which models what the
    /// user was shown, keeps using the tuned default, so this override changes
    /// gating only.
    pub show_threshold: Option<f32>,
}

/// A word-completion engine. Called from one engine thread only.
pub trait Predictor: Send {
    /// Best completion for `query`, already gated by the show threshold, or
    /// `None` to show nothing. Must not change learned state; `&mut` exists
    /// only for inference caches (e.g. a KV cache keyed by `before`).
    fn complete(&mut self, query: &Query<'_>) -> Option<Suggestion>;
    /// Learn from one submitted prompt (bootstrap history rows and live
    /// submissions go through this same path). Engines own their filtering of
    /// code, pastes, and misspellings.
    fn observe(&mut self, prompt: &str);
    /// Learn from a suggestion the user accepted (Tab) or typed past.
    fn feedback(&mut self, query: &Query<'_>, suggestion: &str, accepted: bool);
    /// Flush learned state to [`Config::state_dir`].
    ///
    /// # Errors
    /// Returns an error when the state directory cannot be written.
    fn persist(&mut self) -> anyhow::Result<()>;
}

pub fn open(config: &Config) -> anyhow::Result<Box<dyn Predictor>> {
    smollm::open(config)
}
