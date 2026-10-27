//! The engine runtime: one tokio runtime on its own OS thread
//! (`keystone-sync`) that runs the sync loop, the engine's sign-out and
//! the event bridge of the active profile.
//!
//! The engine does its SQLite work inline on the task that calls it (crate
//! note O6). Running it here keeps that work off the Tauri runtime that
//! serves the commands: a long pull page never stalls an `api_request`.

use std::future::Future;
use std::thread::JoinHandle;

use tokio::runtime::Handle;
use tokio::sync::oneshot;
use tokio::task::JoinHandle as TaskHandle;

/// Name of the runtime's OS thread.
pub const THREAD_NAME: &str = "keystone-sync";

/// Owner of the engine runtime thread. Dropping it stops the runtime: tasks
/// still running are cancelled at their next await.
#[derive(Debug)]
pub struct EngineRuntime {
    handle: Handle,
    stop: Option<oneshot::Sender<()>>,
    thread: Option<JoinHandle<()>>,
}

impl EngineRuntime {
    pub fn start() -> std::io::Result<Self> {
        let runtime = tokio::runtime::Builder::new_current_thread()
            .enable_all()
            .thread_name(THREAD_NAME)
            .build()?;
        let handle = runtime.handle().clone();
        let (stop, stopped) = oneshot::channel::<()>();
        let thread = std::thread::Builder::new()
            .name(THREAD_NAME.to_owned())
            .spawn(move || {
                // Runs every spawned task until the owner drops the sender.
                let _ = runtime.block_on(stopped);
            })?;
        Ok(Self {
            handle,
            stop: Some(stop),
            thread: Some(thread),
        })
    }

    pub fn handle(&self) -> &Handle {
        &self.handle
    }

    /// Runs `future` on the runtime thread.
    pub fn spawn<F>(&self, future: F) -> TaskHandle<F::Output>
    where
        F: Future + Send + 'static,
        F::Output: Send + 'static,
    {
        self.handle.spawn(future)
    }
}

impl Drop for EngineRuntime {
    fn drop(&mut self) {
        drop(self.stop.take());
        if let Some(thread) = self.thread.take()
            && thread.thread().id() != std::thread::current().id()
        {
            let _ = thread.join();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn tasks_run_on_the_runtime_thread() {
        let runtime = EngineRuntime::start().unwrap();
        let name = runtime
            .spawn(async { std::thread::current().name().map(str::to_owned) })
            .await
            .unwrap();
        assert_eq!(name.as_deref(), Some(THREAD_NAME));
        assert_ne!(std::thread::current().name(), Some(THREAD_NAME));
    }

    #[tokio::test]
    async fn dropping_the_runtime_cancels_its_tasks() {
        let runtime = EngineRuntime::start().unwrap();
        let task = runtime.spawn(std::future::pending::<()>());
        drop(runtime);
        assert!(task.await.unwrap_err().is_cancelled());
    }
}
