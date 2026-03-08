<?php
// wheel.php
// POST player_id, token, action=check|spin
//
// action=check  → returns { eligible: bool, next_spin_at: unix_ts_or_0 }
// action=spin   → if eligible, picks a prize, records spin, returns { prize_type, prize_amount, coins, gems }
//
// Cooldown: 24 hours between spins (configurable below)

require __DIR__ . '/_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$player    = require_auth();
$player_id = $player['id'];
$action    = trim($_POST['action'] ?? 'check');

define('SPIN_COOLDOWN_SECS', 86400); // 24 h

$pdo = db();

// --- check eligibility -------------------------------------------------------
$row = $pdo->prepare("SELECT last_spin_at FROM wheel_spins WHERE player_id=?");
$row->execute([$player_id]);
$spin = $row->fetch();
$now = time();

$eligible     = !$spin || ($now - (int)$spin['last_spin_at']) >= SPIN_COOLDOWN_SECS;
$next_spin_at = $spin ? ((int)$spin['last_spin_at'] + SPIN_COOLDOWN_SECS) : 0;

if ($action === 'check') {
    ok(['eligible' => $eligible, 'next_spin_at' => $eligible ? 0 : $next_spin_at]);
}

if ($action !== 'spin') fail('action must be check or spin');
if (!$eligible) fail('not eligible yet: next spin at ' . $next_spin_at);

// --- pick prize --------------------------------------------------------------
// Weighted table: [prize_type, prize_amount, weight]
$prizes = [
    ['coins',  50,   25],
    ['coins',  100,  20],
    ['coins',  200,  15],
    ['coins',  500,  10],
    ['coins',  1000,  5],
    ['gems',    5,   10],
    ['gems',   10,    8],
    ['gems',   20,    5],
    ['gems',   50,    2],
];
$total_weight = array_sum(array_column($prizes, 2));
$r = random_int(1, $total_weight);
$cum = 0;
$prize = $prizes[0];
foreach ($prizes as $p) {
    $cum += $p[2];
    if ($r <= $cum) { $prize = $p; break; }
}
[$prize_type, $prize_amount] = $prize;

// --- award + record ----------------------------------------------------------
$pdo->beginTransaction();
try {
    if ($prize_type === 'coins') {
        $pdo->prepare("UPDATE players SET coins=coins+? WHERE id=?")->execute([$prize_amount, $player_id]);
        $pdo->prepare("INSERT INTO transactions (player_id,delta_coins,delta_gems,reason,created_at) VALUES (?,?,0,'wheel_spin',?)")
            ->execute([$player_id, $prize_amount, $now]);
    } else {
        $pdo->prepare("UPDATE players SET gems=gems+? WHERE id=?")->execute([$prize_amount, $player_id]);
        $pdo->prepare("INSERT INTO transactions (player_id,delta_coins,delta_gems,reason,created_at) VALUES (?,0,?,'wheel_spin',?)")
            ->execute([$player_id, $prize_amount, $now]);
    }

    // upsert spin timestamp
    $pdo->prepare("INSERT INTO wheel_spins (player_id,last_spin_at) VALUES (?,?)
                   ON CONFLICT(player_id) DO UPDATE SET last_spin_at=excluded.last_spin_at")
        ->execute([$player_id, $now]);

    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    fail('db error: ' . $e->getMessage(), 500);
}

$cur = $pdo->prepare("SELECT coins, gems FROM players WHERE id=?");
$cur->execute([$player_id]);
$b = $cur->fetch();
ok([
    'prize_type'   => $prize_type,
    'prize_amount' => $prize_amount,
    'coins'        => (int)$b['coins'],
    'gems'         => (int)$b['gems'],
    'next_spin_at' => $now + SPIN_COOLDOWN_SECS,
]);
