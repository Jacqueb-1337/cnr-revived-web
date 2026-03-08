<?php
// spend.php
// POST player_id, token, coins=N, gems=N, reason=..., match_id=...
// Server-authoritative deduction. Returns fail if insufficient balance.
// Returns: coins, gems (new totals)

require __DIR__ . '/_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$player     = require_auth();
$player_id  = $player['id'];
$delta_coins = max(0, (int)($_POST['coins'] ?? 0));
$delta_gems  = max(0, (int)($_POST['gems']  ?? 0));
$reason     = substr(trim($_POST['reason'] ?? 'spend'), 0, 64);
$match_id   = trim($_POST['match_id'] ?? '') ?: null;

if ($delta_coins === 0 && $delta_gems === 0) fail('nothing to spend');

$pdo = db();
$pdo->beginTransaction();
try {
    // Idempotent: already spent this match_id
    if ($match_id !== null) {
        $check = $pdo->prepare("SELECT id FROM transactions WHERE player_id=? AND match_id=?");
        $check->execute([$player_id, $match_id]);
        if ($check->fetch()) {
            $pdo->rollBack();
            $cur = $pdo->prepare("SELECT coins, gems FROM players WHERE id=?");
            $cur->execute([$player_id]);
            $b = $cur->fetch();
            ok(['coins' => (int)$b['coins'], 'gems' => (int)$b['gems'], 'duplicate' => true]);
        }
    }

    // Check balance (SELECT with exclusive lock via transaction)
    $cur = $pdo->prepare("SELECT coins, gems FROM players WHERE id=?");
    $cur->execute([$player_id]);
    $b = $cur->fetch();
    if ((int)$b['coins'] < $delta_coins) { $pdo->rollBack(); fail('insufficient coins'); }
    if ((int)$b['gems']  < $delta_gems)  { $pdo->rollBack(); fail('insufficient gems'); }

    $pdo->prepare("UPDATE players SET coins=coins-?, gems=gems-? WHERE id=?")
        ->execute([$delta_coins, $delta_gems, $player_id]);

    $pdo->prepare("INSERT INTO transactions (player_id,delta_coins,delta_gems,reason,match_id,created_at) VALUES (?,?,?,?,?,?)")
        ->execute([$player_id, -$delta_coins, -$delta_gems, $reason, $match_id, time()]);

    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
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
