<?php
// earn.php
// POST player_id, token, coins=N, gems=N, reason=..., match_id=...
// match_id: optional dedup key — same player + same match_id will NOT earn twice.
// Used for: kill_reward, round_end, achievement, gift_wheel_prize
// Returns: coins, gems (new totals)

require __DIR__ . '/_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$player     = require_auth();
$player_id  = $player['id'];
$delta_coins = max(0, (int)($_POST['coins'] ?? 0));
$delta_gems  = max(0, (int)($_POST['gems']  ?? 0));
$reason     = substr(trim($_POST['reason'] ?? 'earn'), 0, 64);
$match_id   = trim($_POST['match_id'] ?? '') ?: null;

if ($delta_coins === 0 && $delta_gems === 0) fail('nothing to add');

// Cap per-request earn to prevent abuse (adjust as needed)
$MAX_COINS_PER_EARN = 5000;
$MAX_GEMS_PER_EARN  = 100;
if ($delta_coins > $MAX_COINS_PER_EARN) fail('earn exceeds per-request cap');
if ($delta_gems  > $MAX_GEMS_PER_EARN)  fail('earn exceeds per-request cap');

$pdo = db();
$pdo->beginTransaction();
try {
    // Idempotent: if match_id already exists for this player, return current balance silently
    if ($match_id !== null) {
        $check = $pdo->prepare("SELECT id FROM transactions WHERE player_id=? AND match_id=?");
        $check->execute([$player_id, $match_id]);
        if ($check->fetch()) {
            $pdo->rollBack();
            // Re-fetch current balance
            $cur = $pdo->prepare("SELECT coins, gems FROM players WHERE id=?");
            $cur->execute([$player_id]);
            $b = $cur->fetch();
            ok(['coins' => (int)$b['coins'], 'gems' => (int)$b['gems'], 'duplicate' => true]);
        }
    }

    $pdo->prepare("UPDATE players SET coins=coins+?, gems=gems+? WHERE id=?")
        ->execute([$delta_coins, $delta_gems, $player_id]);

    $pdo->prepare("INSERT INTO transactions (player_id,delta_coins,delta_gems,reason,match_id,created_at) VALUES (?,?,?,?,?,?)")
        ->execute([$player_id, $delta_coins, $delta_gems, $reason, $match_id, time()]);

    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    // Unique constraint on (player_id, match_id) hit by race — treat as duplicate
    if (str_contains($e->getMessage(), 'UNIQUE')) {
        $cur = $pdo->prepare("SELECT coins, gems FROM players WHERE id=?");
        $cur->execute([$player_id]);
        $b = $cur->fetch();
        ok(['coins' => (int)$b['coins'], 'gems' => (int)$b['gems'], 'duplicate' => true]);
    }
    fail('db error: ' . $e->getMessage(), 500);
}

$cur = $pdo->prepare("SELECT coins, gems FROM players WHERE id=?");
$cur->execute([$player_id]);
$b = $cur->fetch();
ok(['coins' => (int)$b['coins'], 'gems' => (int)$b['gems']]);
