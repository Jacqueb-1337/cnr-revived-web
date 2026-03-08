<?php
// _db.php — shared DB connection + helpers (not publicly accessible by name convention)
// SQLite file lives one level above the web root to prevent direct download.
// Adjust DB_PATH if your host layout differs.

define('DB_PATH', __DIR__ . '/../../cnr_economy.db');
define('API_VERSION', 1);

// ---------- open / init -------------------------------------------------------
function db(): PDO {
    static $pdo = null;
    if ($pdo) return $pdo;

    $pdo = new PDO('sqlite:' . DB_PATH, null, null, [
        PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
        PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
    ]);
    // WAL mode: safe for concurrent PHP requests
    $pdo->exec("PRAGMA journal_mode=WAL");
    $pdo->exec("PRAGMA foreign_keys=ON");
    init_schema($pdo);
    return $pdo;
}

function init_schema(PDO $pdo): void {
    $pdo->exec("
        CREATE TABLE IF NOT EXISTS players (
            id            TEXT    PRIMARY KEY,   -- ANDROID_ID (hex string)
            display_name  TEXT    NOT NULL DEFAULT '',
            token         TEXT    NOT NULL,      -- random 32-byte hex, never changes unless claimed
            pin_hash      TEXT    DEFAULT NULL,  -- bcrypt hash for cross-device transfer
            coins         INTEGER NOT NULL DEFAULT 0,
            gems          INTEGER NOT NULL DEFAULT 0,
            registered_at INTEGER NOT NULL,
            last_seen     INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS transactions (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id  TEXT    NOT NULL,
            delta_coins INTEGER NOT NULL DEFAULT 0,
            delta_gems  INTEGER NOT NULL DEFAULT 0,
            reason      TEXT    NOT NULL DEFAULT '',
            match_id    TEXT    DEFAULT NULL,   -- dedup key for earn ops
            created_at  INTEGER NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players(id)
        );
        CREATE UNIQUE INDEX IF NOT EXISTS ux_tx_match
            ON transactions(player_id, match_id)
            WHERE match_id IS NOT NULL;
        CREATE TABLE IF NOT EXISTS wheel_spins (
            player_id   TEXT    PRIMARY KEY,
            last_spin_at INTEGER NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players(id)
        );
        CREATE TABLE IF NOT EXISTS player_mail (
            id         INTEGER PRIMARY KEY AUTOINCREMENT,
            player_id  TEXT    NOT NULL,
            subject    TEXT    NOT NULL DEFAULT '',
            body       TEXT    NOT NULL DEFAULT '',
            coins      INTEGER NOT NULL DEFAULT 0,
            gems       INTEGER NOT NULL DEFAULT 0,
            claimed    INTEGER NOT NULL DEFAULT 0,
            sent_at    INTEGER NOT NULL,
            FOREIGN KEY (player_id) REFERENCES players(id)
        );
        CREATE TABLE IF NOT EXISTS content_items (
            id            TEXT    PRIMARY KEY,
            type          TEXT    NOT NULL DEFAULT 'map',
            name          TEXT    NOT NULL DEFAULT '',
            url           TEXT    NOT NULL DEFAULT '',
            base_scene    TEXT    NOT NULL DEFAULT 'FreeRun3_1',
            material_name TEXT    NOT NULL DEFAULT '',
            data_key      TEXT    NOT NULL DEFAULT '',
            sort_order    INTEGER NOT NULL DEFAULT 0,
            enabled       INTEGER NOT NULL DEFAULT 1,
            created_at    INTEGER NOT NULL DEFAULT 0
        );
    ");
}

// ---------- response helpers -------------------------------------------------
function ok(array $data = []): never {
    header('Content-Type: application/json');
    echo json_encode(array_merge(['ok' => true, 'v' => API_VERSION], $data));
    exit;
}

function fail(string $msg, int $http = 400): never {
    http_response_code($http);
    header('Content-Type: application/json');
    echo json_encode(['ok' => false, 'error' => $msg, 'v' => API_VERSION]);
    exit;
}

// ---------- auth -------------------------------------------------------------
function require_auth(): array {
    $player_id = trim($_POST['player_id'] ?? $_GET['player_id'] ?? '');
    $token     = trim($_POST['token']     ?? $_GET['token']     ?? '');

    if ($player_id === '' || $token === '') fail('missing player_id or token', 401);
    // Validate format: ANDROID_ID is 16 hex chars; token is 64 hex chars
    if (!preg_match('/^[0-9a-f]{1,64}$/i', $player_id)) fail('invalid player_id', 401);
    if (!preg_match('/^[0-9a-f]{64}$/i', $token))       fail('invalid token', 401);

    $row = db()->prepare("SELECT * FROM players WHERE id=? AND token=?");
    $row->execute([$player_id, strtolower($token)]);
    $player = $row->fetch();
    if (!$player) fail('unauthorized', 401);

    // touch last_seen
    db()->prepare("UPDATE players SET last_seen=? WHERE id=?")
        ->execute([time(), $player_id]);

    return $player;
}

// ---------- CORS (game client sends from Android, no browser origin) ---------
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') { http_response_code(204); exit; }
