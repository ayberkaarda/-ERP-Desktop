//! A scripted HTTP/1.1 server on loopback for the tests of cut and slow
//! connections. Each request it reads in full counts as "applied" (worst
//! case: the server committed it). What it does next is chosen per
//! connection and per request on that connection by `plan`.
#![allow(dead_code)]

use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use tokio::io::{AsyncReadExt, AsyncWriteExt};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Act {
    /// 201 with a JSON body, keep-alive.
    Answer,
    /// 201, then close the connection at once (FIN) after the answer.
    AnswerThenClose,
    /// 201, then close the idle connection (FIN) after the delay.
    AnswerThenIdleClose(Duration),
    /// 201, then reset the idle connection (RST) after the delay.
    AnswerThenIdleReset(Duration),
    /// Read the whole request, then close (FIN) without an answer.
    CloseAfterRead,
    /// Read the whole request, then reset (RST) without an answer.
    ResetAfterRead,
    /// Do not read the request at all: reset at once (RST).
    ResetBeforeRead,
    /// Read the whole request, then say nothing for this long.
    SilentAfterRead(Duration),
    /// Read only part of the headers, then reset.
    ResetMidHeaders,
    /// Read the whole request, answer 201 with a body cut short, close.
    PartialBody,
}

#[derive(Clone)]
pub struct Raw {
    pub port: u16,
    /// Requests read in full (method and path), in order.
    pub applied: Arc<Mutex<Vec<String>>>,
    /// Connections accepted.
    pub connections: Arc<AtomicUsize>,
    /// Requests whose first bytes arrived, read in full or not.
    pub arrived: Arc<AtomicUsize>,
}

impl Raw {
    pub fn applied(&self) -> usize {
        self.applied.lock().unwrap().len()
    }
    pub fn applied_to(&self, wanted: &str) -> usize {
        self.applied
            .lock()
            .unwrap()
            .iter()
            .filter(|line| line.contains(wanted))
            .count()
    }
    pub fn connections(&self) -> usize {
        self.connections.load(Ordering::SeqCst)
    }
    pub fn url(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }
}

type Plan = Arc<dyn Fn(usize, usize, &str) -> Act + Send + Sync>;

/// `plan(connection index, request index on it, request line)`.
pub fn start(plan: impl Fn(usize, usize, &str) -> Act + Send + Sync + 'static) -> Raw {
    let std_listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let port = std_listener.local_addr().unwrap().port();
    std_listener.set_nonblocking(true).unwrap();
    let raw = Raw {
        port,
        applied: Arc::default(),
        connections: Arc::default(),
        arrived: Arc::default(),
    };
    let plan: Plan = Arc::new(plan);
    let shared = raw.clone();
    std::thread::spawn(move || {
        let rt = tokio::runtime::Builder::new_multi_thread()
            .worker_threads(2)
            .enable_all()
            .build()
            .unwrap();
        rt.block_on(async move {
            let listener = tokio::net::TcpListener::from_std(std_listener).unwrap();
            loop {
                let Ok((socket, _)) = listener.accept().await else {
                    continue;
                };
                let index = shared.connections.fetch_add(1, Ordering::SeqCst);
                let (plan, shared) = (plan.clone(), shared.clone());
                tokio::spawn(async move { connection(socket, index, plan, shared).await });
            }
        });
    });
    raw
}

#[allow(deprecated)]
fn reset(socket: tokio::net::TcpStream) {
    let _ = socket.set_linger(Some(Duration::ZERO));
    drop(socket);
}

async fn connection(mut socket: tokio::net::TcpStream, index: usize, plan: Plan, shared: Raw) {
    let mut buffer: Vec<u8> = Vec::new();
    let mut request_no = 0usize;
    loop {
        // Wait for the first bytes of a request.
        let mut chunk = [0u8; 8192];
        while !contains(&buffer, b"\r\n") {
            match socket.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            }
        }
        shared.arrived.fetch_add(1, Ordering::SeqCst);
        let line_end = find(&buffer, b"\r\n").unwrap();
        let line = String::from_utf8_lossy(&buffer[..line_end]).to_string();
        let act = plan(index, request_no, &line);
        if act == Act::ResetBeforeRead {
            reset(socket);
            return;
        }
        if act == Act::ResetMidHeaders {
            reset(socket);
            return;
        }
        while !contains(&buffer, b"\r\n\r\n") {
            match socket.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            }
        }
        let head_end = find(&buffer, b"\r\n\r\n").unwrap() + 4;
        let head = String::from_utf8_lossy(&buffer[..head_end]).to_ascii_lowercase();
        let length = head
            .lines()
            .find_map(|l| l.strip_prefix("content-length:"))
            .and_then(|v| v.trim().parse::<usize>().ok())
            .unwrap_or(0);
        while buffer.len() < head_end + length {
            match socket.read(&mut chunk).await {
                Ok(0) | Err(_) => return,
                Ok(n) => buffer.extend_from_slice(&chunk[..n]),
            }
        }
        buffer.drain(..head_end + length);
        shared.applied.lock().unwrap().push(line.clone());
        request_no += 1;
        let body = br#"{"data":{"id":"0192f5a0-0000-7000-8000-00000000000a","name":"Acme"}}"#;
        let answer = |close: bool| {
            let mut out = format!(
                "HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: {}\r\n{}\r\n",
                body.len(),
                if close { "connection: close\r\n" } else { "" }
            )
            .into_bytes();
            out.extend_from_slice(body);
            out
        };
        match act {
            Act::Answer => {
                if socket.write_all(&answer(false)).await.is_err() {
                    return;
                }
            }
            Act::AnswerThenClose => {
                let _ = socket.write_all(&answer(false)).await;
                let _ = socket.shutdown().await;
                return;
            }
            Act::AnswerThenIdleClose(after) => {
                let _ = socket.write_all(&answer(false)).await;
                tokio::time::sleep(after).await;
                let _ = socket.shutdown().await;
                drop(socket);
                return;
            }
            Act::AnswerThenIdleReset(after) => {
                let _ = socket.write_all(&answer(false)).await;
                tokio::time::sleep(after).await;
                reset(socket);
                return;
            }
            Act::CloseAfterRead => {
                let _ = socket.shutdown().await;
                drop(socket);
                return;
            }
            Act::ResetAfterRead => {
                reset(socket);
                return;
            }
            Act::SilentAfterRead(hold) => {
                tokio::time::sleep(hold).await;
                return;
            }
            Act::PartialBody => {
                let head = "HTTP/1.1 201 Created\r\ncontent-type: application/json\r\ncontent-length: 200\r\n\r\n{\"data\":";
                let _ = socket.write_all(head.as_bytes()).await;
                let _ = socket.flush().await;
                tokio::time::sleep(Duration::from_millis(50)).await;
                let _ = socket.shutdown().await;
                return;
            }
            Act::ResetBeforeRead | Act::ResetMidHeaders => unreachable!(),
        }
    }
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

fn contains(haystack: &[u8], needle: &[u8]) -> bool {
    find(haystack, needle).is_some()
}
