<?php
// register.php
// POST player_id, display_name
// Returns: token (new or existing), coins, gems
// If the player_id already exists AND the supplied token matches -> re-login (refresh last_seen)
// If the player_id already exists but no token supplied -> reject (must use claim.php for PIN transfer)
// If the player_id is new -> create account, return fresh token

require __DIR__ . '/_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$player_id   = trim($_POST['player_id']   ?? '');
$display_name = substr(trim($_POST['display_name'] ?? 'Player'), 0, 32);
$token_in    = trim($_POST['token'] ?? '');

if ($player_id === '') fail('missing player_id');
if (!preg_match('/^[0-9a-f]{1,64}$/i', $player_id)) fail('invalid player_id');

$pdo = db();

$stmt = $pdo->prepare("SELECT * FROM players WHERE id=?");
$stmt->execute([$player_id]);
$existing = $stmt->fetch();

if ($existing) {
    // Known device: token must match to re-authenticate
    if ($token_in !== '' && strtolower($token_in) === $existing['token']) {
        // Valid re-login — update display name + last_seen
        $pdo->prepare("UPDATE players SET display_name=?, last_seen=? WHERE id=?")
            ->execute([$display_name, time(), $player_id]);
        ok(['token' => $existing['token'], 'coins' => $existing['coins'], 'gems' => $existing['gems'], 'new' => false]);
    }
    // Wrong / missing token but player exists: don't reveal account data
    fail('player_id already registered — use your stored token or claim.php to transfer', 409);
}

// New registration
$token = bin2hex(random_bytes(32)); // 64-char hex
$now   = time();
$pdo->prepare("
    INSERT INTO players (id, display_name, token, coins, gems, registered_at, last_seen)
    VALUES (?, ?, ?, 0, 0, ?, ?)
")->execute([$player_id, $display_name, $token, $now, $now]);

ok(['token' => $token, 'coins' => 0, 'gems' => 0, 'new' => true]);
