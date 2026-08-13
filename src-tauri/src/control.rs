//! The Arclight control API.
//!
//! An opt-in local HTTP server that lets other systems drive the workspace:
//! read the frame tree, open files into specific frames, split and close
//! frames, and write into terminals. This is the surface AIM, Aether and local
//! automation talk to.
//!
//! Deliberately *not* a bundled Node runtime. Arclight speaks a small protocol
//! of its own and stays a 4 MB binary; gateways like dnet-api-node sit in front
//! of it as ordinary clients.
//!
//! Three properties, because this is a remote-control surface for a program
//! that edits files and runs shells:
//!
//! - **Off by default.** Nothing listens until the user enables it.
//! - **Loopback only by default.** Binding beyond 127.0.0.1 is a separate,
//!   explicit choice.
//! - **Token required.** Every route except `/v1/health` needs the bearer
//!   token, compared in constant time.
//!
//! State lives in the webview, so the server mirrors it: the frontend
//! publishes a snapshot whenever the workspace changes, and commands are
//! bridged to the frontend and awaited.

use std::collections::HashMap;
use std::net::{IpAddr, Ipv4Addr, SocketAddr};
use std::sync::Arc;
use std::time::Duration;

use axum::extract::{Path as AxumPath, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::sse::{Event, KeepAlive, Sse};
use axum::response::IntoResponse;
use axum::routing::{get, post};
use axum::{Json, Router};
use futures::stream::Stream;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use tauri::{AppHandle, Emitter, State as TauriState};
use tokio::sync::{broadcast, oneshot};

/// How long a bridged command may take before the caller gets a timeout.
const COMMAND_TIMEOUT: Duration = Duration::from_secs(10);

/// Cap on queued events for a slow SSE subscriber.
const EVENT_BUFFER: usize = 256;

#[derive(Clone, Debug, Serialize, Deserialize)]
pub struct ControlConfig {
    pub enabled: bool,
    pub port: u16,
    /// Bearer token. Generated when empty.
    pub token: String,
    /// Allow non-loopback clients. Off unless deliberately turned on.
    pub allow_remote: bool,
}

impl Default for ControlConfig {
    fn default() -> Self {
        Self {
            enabled: false,
            port: 8787,
            token: String::new(),
            allow_remote: false,
        }
    }
}

#[derive(Clone, Serialize)]
pub struct ControlStatus {
    pub running: bool,
    pub port: u16,
    pub token: String,
    pub allow_remote: bool,
    pub address: Option<String>,
}

struct Inner {
    config: ControlConfig,
    /// Latest workspace snapshot, published by the frontend.
    snapshot: Value,
    /// Bridged commands awaiting a frontend response.
    pending: HashMap<String, oneshot::Sender<Value>>,
    shutdown: Option<oneshot::Sender<()>>,
    address: Option<String>,
}

pub struct ControlState {
    inner: Mutex<Inner>,
    events: broadcast::Sender<String>,
}

impl Default for ControlState {
    fn default() -> Self {
        let (events, _) = broadcast::channel(EVENT_BUFFER);
        Self {
            inner: Mutex::new(Inner {
                config: ControlConfig::default(),
                snapshot: json!({ "frames": [], "settings": null }),
                pending: HashMap::new(),
                shutdown: None,
                address: None,
            }),
            events,
        }
    }
}

/// Shared with axum handlers.
#[derive(Clone)]
struct ServerContext {
    app: AppHandle,
    state: Arc<ControlState>,
}

fn random_token() -> String {
    uuid::Uuid::new_v4().simple().to_string()
}

/// Compare in constant time so a token cannot be recovered by timing replies.
fn token_matches(expected: &str, provided: &str) -> bool {
    if expected.is_empty() {
        return false;
    }
    let a = expected.as_bytes();
    let b = provided.as_bytes();
    let mut diff = a.len() ^ b.len();
    for i in 0..a.len().max(b.len()) {
        let x = a.get(i).copied().unwrap_or(0);
        let y = b.get(i).copied().unwrap_or(0);
        diff |= (x ^ y) as usize;
    }
    diff == 0
}

fn authorize(ctx: &ServerContext, headers: &HeaderMap) -> Result<(), (StatusCode, Json<Value>)> {
    let expected = ctx.state.inner.lock().config.token.clone();

    let provided = headers
        .get("authorization")
        .and_then(|v| v.to_str().ok())
        .and_then(|v| v.strip_prefix("Bearer "))
        .or_else(|| headers.get("x-arclight-token").and_then(|v| v.to_str().ok()))
        .unwrap_or("");

    if token_matches(&expected, provided) {
        Ok(())
    } else {
        Err((
            StatusCode::UNAUTHORIZED,
            Json(json!({ "error": "invalid or missing token" })),
        ))
    }
}

/// Send a command to the frontend and wait for its reply.
async fn bridge(ctx: &ServerContext, action: &str, payload: Value) -> Result<Value, String> {
    let id = uuid::Uuid::new_v4().to_string();
    let (tx, rx) = oneshot::channel();

    ctx.state.inner.lock().pending.insert(id.clone(), tx);

    ctx.app
        .emit(
            "control:request",
            json!({ "id": id, "action": action, "payload": payload }),
        )
        .map_err(|e| format!("could not reach the workspace: {e}"))?;

    match tokio::time::timeout(COMMAND_TIMEOUT, rx).await {
        Ok(Ok(value)) => Ok(value),
        Ok(Err(_)) => {
            ctx.state.inner.lock().pending.remove(&id);
            Err("the workspace dropped the request".into())
        }
        Err(_) => {
            ctx.state.inner.lock().pending.remove(&id);
            Err(format!("timed out after {}s", COMMAND_TIMEOUT.as_secs()))
        }
    }
}

fn bridged(result: Result<Value, String>) -> impl IntoResponse {
    match result {
        Ok(value) => {
            // The frontend reports its own failures inside the payload.
            if let Some(err) = value.get("error").and_then(|e| e.as_str()) {
                return (
                    StatusCode::BAD_REQUEST,
                    Json(json!({ "error": err })),
                );
            }
            (StatusCode::OK, Json(value))
        }
        Err(err) => (
            StatusCode::SERVICE_UNAVAILABLE,
            Json(json!({ "error": err })),
        ),
    }
}

// --- routes ----------------------------------------------------------------

async fn health(State(ctx): State<ServerContext>) -> impl IntoResponse {
    let running = ctx.state.inner.lock().address.is_some();
    Json(json!({
        "ok": true,
        "app": "arclight",
        "version": env!("CARGO_PKG_VERSION"),
        "running": running,
    }))
}

async fn get_state(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    Ok(Json(ctx.state.inner.lock().snapshot.clone()))
}

async fn get_frames(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
) -> Result<Json<Value>, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let snapshot = ctx.state.inner.lock().snapshot.clone();
    Ok(Json(
        snapshot.get("frames").cloned().unwrap_or_else(|| json!([])),
    ))
}

#[derive(Deserialize)]
struct OpenBody {
    path: String,
    #[serde(default)]
    frame_id: Option<String>,
    #[serde(default)]
    new_frame: Option<bool>,
    #[serde(default)]
    direction: Option<String>,
}

async fn open_file(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    Json(body): Json<OpenBody>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let result = bridge(
        &ctx,
        "open",
        json!({
            "path": body.path,
            "frameId": body.frame_id,
            "newFrame": body.new_frame,
            "direction": body.direction,
        }),
    )
    .await;
    Ok(bridged(result).into_response())
}

#[derive(Deserialize)]
struct SplitBody {
    frame_id: String,
    #[serde(default = "default_direction")]
    direction: String,
    tool: String,
    #[serde(default)]
    context: Option<Value>,
}

fn default_direction() -> String {
    "vertical".into()
}

async fn split_frame(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    Json(body): Json<SplitBody>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let result = bridge(
        &ctx,
        "split",
        json!({
            "frameId": body.frame_id,
            "direction": body.direction,
            "tool": body.tool,
            "context": body.context,
        }),
    )
    .await;
    Ok(bridged(result).into_response())
}

#[derive(Deserialize)]
struct ToolBody {
    tool: String,
}

async fn set_tool(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    AxumPath(frame_id): AxumPath<String>,
    Json(body): Json<ToolBody>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let result = bridge(
        &ctx,
        "setTool",
        json!({ "frameId": frame_id, "tool": body.tool }),
    )
    .await;
    Ok(bridged(result).into_response())
}

async fn close_frame(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    AxumPath(frame_id): AxumPath<String>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let result = bridge(&ctx, "close", json!({ "frameId": frame_id })).await;
    Ok(bridged(result).into_response())
}

async fn select_frame(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    AxumPath(frame_id): AxumPath<String>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let target = if frame_id == "none" {
        Value::Null
    } else {
        Value::String(frame_id)
    };
    let result = bridge(&ctx, "select", json!({ "frameId": target })).await;
    Ok(bridged(result).into_response())
}

#[derive(Deserialize)]
struct CommandBody {
    /// A `dnet` command line, without the `dnet` prefix.
    command: String,
    #[serde(default)]
    frame_id: Option<String>,
}

async fn run_command(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    Json(body): Json<CommandBody>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let result = bridge(
        &ctx,
        "command",
        json!({ "command": body.command, "frameId": body.frame_id }),
    )
    .await;
    Ok(bridged(result).into_response())
}

#[derive(Deserialize)]
struct WriteBody {
    data: String,
}

async fn terminal_write(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
    AxumPath(frame_id): AxumPath<String>,
    Json(body): Json<WriteBody>,
) -> Result<axum::response::Response, (StatusCode, Json<Value>)> {
    authorize(&ctx, &headers)?;
    let result = bridge(
        &ctx,
        "terminalWrite",
        json!({ "frameId": frame_id, "data": body.data }),
    )
    .await;
    Ok(bridged(result).into_response())
}

/// Server-sent stream of workspace events.
async fn events(
    State(ctx): State<ServerContext>,
    headers: HeaderMap,
) -> Result<Sse<impl Stream<Item = Result<Event, std::convert::Infallible>>>, (StatusCode, Json<Value>)>
{
    authorize(&ctx, &headers)?;

    let mut rx = ctx.state.events.subscribe();
    let stream = async_stream::stream! {
        loop {
            match rx.recv().await {
                Ok(payload) => yield Ok(Event::default().data(payload)),
                // A subscriber that fell behind resumes from the newest event
                // rather than killing the stream.
                Err(broadcast::error::RecvError::Lagged(_)) => continue,
                Err(broadcast::error::RecvError::Closed) => break,
            }
        }
    };

    Ok(Sse::new(stream).keep_alive(KeepAlive::default()))
}

fn router(ctx: ServerContext) -> Router {
    Router::new()
        .route("/v1/health", get(health))
        .route("/v1/state", get(get_state))
        .route("/v1/frames", get(get_frames))
        .route("/v1/frames/split", post(split_frame))
        .route("/v1/frames/{id}/tool", post(set_tool))
        .route("/v1/frames/{id}/close", post(close_frame))
        .route("/v1/frames/{id}/select", post(select_frame))
        .route("/v1/open", post(open_file))
        .route("/v1/command", post(run_command))
        .route("/v1/terminal/{id}/write", post(terminal_write))
        .route("/v1/events", get(events))
        .with_state(ctx)
}

// --- Tauri commands --------------------------------------------------------

fn status_of(state: &ControlState) -> ControlStatus {
    let inner = state.inner.lock();
    ControlStatus {
        running: inner.address.is_some(),
        port: inner.config.port,
        token: inner.config.token.clone(),
        allow_remote: inner.config.allow_remote,
        address: inner.address.clone(),
    }
}

#[tauri::command]
pub fn control_status(state: TauriState<'_, Arc<ControlState>>) -> ControlStatus {
    status_of(&state)
}

#[tauri::command]
pub async fn control_start(
    app: AppHandle,
    state: TauriState<'_, Arc<ControlState>>,
    mut config: ControlConfig,
) -> Result<ControlStatus, String> {
    let shared = state.inner().clone();

    // Restart cleanly if it is already up.
    stop_server(&shared);

    if config.token.trim().is_empty() {
        config.token = random_token();
    }

    let host = if config.allow_remote {
        IpAddr::V4(Ipv4Addr::UNSPECIFIED)
    } else {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    };
    let addr = SocketAddr::new(host, config.port);

    {
        let mut inner = shared.inner.lock();
        inner.config = config.clone();
    }

    let ctx = ServerContext {
        app: app.clone(),
        state: shared.clone(),
    };

    let listener = tokio::net::TcpListener::bind(addr)
        .await
        .map_err(|e| format!("could not bind {addr}: {e}"))?;

    let bound = listener
        .local_addr()
        .map(|a| a.to_string())
        .unwrap_or_else(|_| addr.to_string());

    let (tx, rx) = oneshot::channel::<()>();
    {
        let mut inner = shared.inner.lock();
        inner.shutdown = Some(tx);
        inner.address = Some(bound.clone());
        inner.config.port = listener.local_addr().map(|a| a.port()).unwrap_or(addr.port());
    }

    let app_for_task = app.clone();
    let shared_for_task = shared.clone();
    tokio::spawn(async move {
        let server = axum::serve(listener, router(ctx)).with_graceful_shutdown(async {
            let _ = rx.await;
        });
        if let Err(err) = server.await {
            eprintln!("control API stopped: {err}");
        }
        let mut inner = shared_for_task.inner.lock();
        inner.address = None;
        inner.shutdown = None;
        drop(inner);
        let _ = app_for_task.emit("control:stopped", json!({}));
    });

    Ok(status_of(&shared))
}

fn stop_server(state: &ControlState) {
    let handle = {
        let mut inner = state.inner.lock();
        inner.address = None;
        inner.shutdown.take()
    };
    if let Some(tx) = handle {
        let _ = tx.send(());
    }
}

#[tauri::command]
pub fn control_stop(state: TauriState<'_, Arc<ControlState>>) -> ControlStatus {
    stop_server(&state);
    status_of(&state)
}

/// The frontend publishes its workspace snapshot here on every change.
#[tauri::command]
pub fn control_publish(state: TauriState<'_, Arc<ControlState>>, snapshot: Value) {
    state.inner.lock().snapshot = snapshot;
}

/// The frontend answers a bridged command.
#[tauri::command]
pub fn control_respond(state: TauriState<'_, Arc<ControlState>>, id: String, result: Value) {
    let tx = state.inner.lock().pending.remove(&id);
    if let Some(tx) = tx {
        let _ = tx.send(result);
    }
}

/// The frontend pushes a workspace event to SSE subscribers.
#[tauri::command]
pub fn control_event(state: TauriState<'_, Arc<ControlState>>, event: Value) {
    // An error here only means nobody is subscribed.
    let _ = state.events.send(event.to_string());
}

#[tauri::command]
pub fn control_rotate_token(state: TauriState<'_, Arc<ControlState>>) -> String {
    let token = random_token();
    state.inner.lock().config.token = token.clone();
    token
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_an_empty_expected_token() {
        assert!(!token_matches("", ""));
        assert!(!token_matches("", "anything"));
    }

    #[test]
    fn accepts_the_exact_token() {
        assert!(token_matches("abc123", "abc123"));
    }

    #[test]
    fn rejects_wrong_and_truncated_tokens() {
        assert!(!token_matches("abc123", "abc124"));
        assert!(!token_matches("abc123", "abc"));
        assert!(!token_matches("abc123", "abc1234"));
    }

    #[test]
    fn defaults_are_closed() {
        let config = ControlConfig::default();
        assert!(!config.enabled, "must not listen unless asked");
        assert!(!config.allow_remote, "must be loopback only by default");
        assert!(config.token.is_empty(), "token is generated at start");
    }
}
