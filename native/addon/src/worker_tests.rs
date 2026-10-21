use super::*;
use ghost_predictor::Suggestion;
use std::sync::{
    Arc,
    atomic::{AtomicUsize, Ordering},
};
struct Fake {
    persisted: Arc<AtomicUsize>,
}
impl Predictor for Fake {
    fn complete(&mut self, _q: &Query<'_>) -> Option<Suggestion> {
        None
    }
    fn observe(&mut self, _p: &str) {}
    fn feedback(&mut self, _q: &Query<'_>, _s: &str, _a: bool) {}
    fn persist(&mut self) -> anyhow::Result<()> {
        self.persisted.fetch_add(1, Ordering::SeqCst);
        Ok(())
    }
}
#[tokio::test]
async fn close_drains_serialized_operations_and_persists_once() {
    let persisted = Arc::new(AtomicUsize::new(0));
    let p = persisted.clone();
    let worker = Worker::spawn(move || Ok(Box::new(Fake { persisted: p }))).unwrap();
    let seen = Arc::new(Mutex::new(Vec::new()));
    for i in 0..5 {
        let s = seen.clone();
        worker
            .run(move |_| {
                s.lock().unwrap().push(i);
                Ok(())
            })
            .await
            .unwrap();
    }
    worker.close().await.unwrap();
    worker.close().await.unwrap();
    assert_eq!(*seen.lock().unwrap(), vec![0, 1, 2, 3, 4]);
    assert_eq!(persisted.load(Ordering::SeqCst), 1);
    assert!(worker.run(|_| Ok(())).await.is_err());
}
#[tokio::test]
async fn startup_error_and_dropped_reply_do_not_leak_thread() {
    let worker = Worker::spawn(|| Err("missing model".into())).unwrap();
    assert!(
        worker
            .run(|_| Ok(()))
            .await
            .unwrap_err()
            .reason
            .contains("missing model")
    );
    worker.close().await.unwrap();
    let persisted = Arc::new(AtomicUsize::new(0));
    let p = persisted.clone();
    let worker = Worker::spawn(move || Ok(Box::new(Fake { persisted: p }))).unwrap();
    let (reply, result) = flume::bounded::<()>(1);
    drop(result);
    worker
        .jobs
        .lock()
        .unwrap()
        .as_ref()
        .unwrap()
        .send(Box::new(move |_| {
            let _ = reply.send(());
        }))
        .unwrap();
    worker.close().await.unwrap();
    assert_eq!(persisted.load(Ordering::SeqCst), 1);
}
#[tokio::test]
async fn backlog_is_bounded_without_blocking_the_submitter() {
    let (release, wait) = flume::bounded::<()>(1);
    let worker = Worker::spawn(move || {
        let _ = wait.recv();
        Err("test".into())
    })
    .unwrap();
    let mut rejected = false;
    {
        let guard = worker.jobs.lock().unwrap();
        let sender = guard.as_ref().unwrap();
        for _ in 0..100 {
            if sender.try_send(Box::new(|_| {})).is_err() {
                rejected = true;
                break;
            }
        }
    }
    release.send(()).unwrap();
    assert!(
        rejected,
        "worker must reject excess backlog instead of growing memory"
    );
    worker.close().await.unwrap();
}
