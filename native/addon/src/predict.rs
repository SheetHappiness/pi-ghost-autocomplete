// Dedicated engine thread adapted from OMP crates/pi-natives/src/predict.rs.
use ghost_predictor::{Config, Predictor, Query};
use napi::{Error, Result, Status};
use napi_derive::napi;
use std::sync::Mutex;
use std::thread::JoinHandle;

#[napi(object)]
pub struct TextPredictorOptions {
    pub state_dir: String,
    pub model_dir: String,
}
#[napi(object)]
pub struct PredictedWord {
    pub suffix: String,
    pub confidence: f64,
}
type Engine = std::result::Result<Box<dyn Predictor>, String>;
type Job = Box<dyn FnOnce(&mut Engine) + Send>;

#[cfg(test)]
#[path = "worker_tests.rs"]
mod tests;

struct Worker {
    jobs: Mutex<Option<flume::Sender<Job>>>,
    thread: Mutex<Option<JoinHandle<std::result::Result<(), String>>>>,
    closed: tokio::sync::OnceCell<std::result::Result<(), String>>,
}
impl Worker {
    fn spawn(open: impl FnOnce() -> Engine + Send + 'static) -> Result<Self> {
        let (jobs, queue) = flume::bounded::<Job>(64);
        let thread = std::thread::Builder::new()
            .name("ghost-smollm".into())
            .spawn(move || {
                let mut engine = open();
                while let Ok(job) = queue.recv() {
                    job(&mut engine);
                }
                match &mut engine {
                    Ok(engine) => engine.persist().map_err(|e| format!("{e:#}")),
                    Err(_) => Ok(()),
                }
            })
            .map_err(|e| Error::new(Status::GenericFailure, e.to_string()))?;
        Ok(Self {
            jobs: Mutex::new(Some(jobs)),
            thread: Mutex::new(Some(thread)),
            closed: tokio::sync::OnceCell::new(),
        })
    }
    async fn run<T: Send + 'static>(
        &self,
        work: impl FnOnce(&mut Box<dyn Predictor>) -> anyhow::Result<T> + Send + 'static,
    ) -> Result<T> {
        let (reply, result) = flume::bounded(1);
        {
            let guard = self
                .jobs
                .lock()
                .map_err(|_| Error::from_reason("worker poisoned"))?;
            let sender = guard
                .as_ref()
                .ok_or_else(|| Error::from_reason("prediction engine closed"))?;
            sender
                .try_send(Box::new(move |engine| {
                    let outcome = match engine {
                        Ok(engine) => work(engine).map_err(|e| format!("{e:#}")),
                        Err(e) => Err(e.clone()),
                    };
                    let _ = reply.send(outcome);
                }))
                .map_err(|error| {
                    Error::from_reason(format!("prediction engine busy or stopped: {error}"))
                })?;
        }
        result
            .recv_async()
            .await
            .map_err(|_| Error::from_reason("prediction engine stopped"))?
            .map_err(Error::from_reason)
    }
    async fn close(&self) -> Result<()> {
        self.closed
            .get_or_init(|| async {
                self.jobs.lock().map_err(|_| "worker poisoned")?.take();
                let thread = self.thread.lock().map_err(|_| "worker poisoned")?.take();
                if let Some(thread) = thread {
                    tokio::task::spawn_blocking(move || {
                        thread
                            .join()
                            .map_err(|_| "prediction worker panicked".to_string())?
                    })
                    .await
                    .map_err(|e| e.to_string())?
                } else {
                    Ok(())
                }
            })
            .await
            .clone()
            .map_err(Error::from_reason)
    }
}

#[napi]
pub struct TextPredictor {
    worker: Worker,
}
#[napi]
impl TextPredictor {
    #[napi(constructor)]
    pub fn new(options: TextPredictorOptions) -> Result<Self> {
        let worker = Worker::spawn(move || {
            ghost_predictor::open(&Config {
                state_dir: options.state_dir.into(),
                model_dir: Some(options.model_dir.into()),
                show_threshold: Some(0.15),
            })
            .map_err(|e| format!("{e:#}"))
        })?;
        Ok(Self { worker })
    }
    #[napi]
    pub async fn ready(&self) -> Result<()> {
        self.worker.run(|_| Ok(())).await
    }
    #[napi]
    pub async fn complete(&self, before: String, prefix: String) -> Result<Option<PredictedWord>> {
        self.worker
            .run(move |engine| {
                Ok(engine
                    .complete(&Query {
                        before: &before,
                        prefix: &prefix,
                    })
                    .map(|s| PredictedWord {
                        suffix: s.suffix,
                        confidence: f64::from(s.confidence),
                    }))
            })
            .await
    }
    #[napi]
    pub async fn observe(&self, prompts: Vec<String>) -> Result<()> {
        self.worker
            .run(move |engine| {
                for prompt in prompts {
                    engine.observe(&prompt);
                }
                Ok(())
            })
            .await
    }
    #[napi]
    pub async fn feedback(
        &self,
        before: String,
        prefix: String,
        suffix: String,
        accepted: bool,
    ) -> Result<()> {
        self.worker
            .run(move |engine| {
                engine.feedback(
                    &Query {
                        before: &before,
                        prefix: &prefix,
                    },
                    &suffix,
                    accepted,
                );
                Ok(())
            })
            .await
    }
    #[napi]
    pub async fn persist(&self) -> Result<()> {
        self.worker.run(|engine| engine.persist()).await
    }
    #[napi]
    pub async fn close(&self) -> Result<()> {
        self.worker.close().await
    }
}
