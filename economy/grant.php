<?php
// grant.php — admin tool to directly set or add currency for a player
// Protected by HTTP basic auth (.htaccess AuthType Basic block)
// Usage (GET in browser or curl):
//   grant.php?list=1                                   — list all players
//   grant.php?id=<player_id>&coins=1000                — add coins
//   grant.php?id=<player_id>&gems=1000                 — add gems
//   grant.php?id=<player_id>&coins=500&gems=50         — add both
//   grant.php?id=<player_id>&set_coins=0&set_gems=0    — set absolute values

require __DIR__ . '/_db.php';
$pdo = db();

header('Content-Type: text/html; charset=utf-8');

// ---- List players -----------------------------------------------------------
if (isset($_GET['list'])) {
    $rows = $pdo->query("SELECT id, display_name, coins, gems, registered_at FROM players ORDER BY coins DESC")->fetchAll();
    echo "<html><head><style>body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px}table{border-collapse:collapse}td,th{padding:4px 12px;border-bottom:1px solid #333}th{color:#58a6ff}a{color:#3fb950}</style></head><body>";
    echo "<h2>Players (" . count($rows) . ")</h2><table><tr><th>ID</th><th>Name</th><th>Coins</th><th>Gems</th><th>Registered</th><th>Grant</th></tr>";
    foreach ($rows as $r) {
        $grantUrl = "grant.php?id=" . urlencode($r['id']) . "&coins=1000";
        echo "<tr><td>" . htmlspecialchars($r['id']) . "</td><td>" . htmlspecialchars($r['display_name']) . "</td><td>{$r['coins']}</td><td>{$r['gems']}</td><td>" . date('Y-m-d', $r['registered_at']) . "</td><td><a href=\"$grantUrl\">+1000 coins</a></td></tr>";
    }
    echo "</table></body></html>";
    exit;
}

// ---- Grant ------------------------------------------------------------------
$id = isset($_GET['id']) ? trim($_GET['id']) : '';
if ($id === '') {
    echo "<html><body style='font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px'>";
    echo "<h2>CNR Grant Tool</h2>";
    echo "<p><a href='grant.php?list=1' style='color:#3fb950'>List all players</a></p>";
    echo "<p>Usage: <code>grant.php?id=PLAYER_ID&amp;coins=1000&amp;gems=50</code></p>";
    echo "<p>Set absolute: <code>grant.php?id=PLAYER_ID&amp;set_coins=500&amp;set_gems=10</code></p>";
    echo "</body></html>";
    exit;
}

$row = $pdo->prepare("SELECT * FROM players WHERE id=?")->execute([$id]) ? $pdo->prepare("SELECT * FROM players WHERE id=?")->query() : null;
$stmt = $pdo->prepare("SELECT * FROM players WHERE id=?");
$stmt->execute([$id]);
$player = $stmt->fetch();

if (!$player) {
    echo "<p style='color:red'>Player not found: " . htmlspecialchars($id) . "</p>";
    exit;
}

$newCoins = (int)$player['coins'];
$newGems  = (int)$player['gems'];

if (isset($_GET['set_coins'])) $newCoins = (int)$_GET['set_coins'];
elseif (isset($_GET['coins']))  $newCoins += (int)$_GET['coins'];

if (isset($_GET['set_gems']))  $newGems = (int)$_GET['set_gems'];
elseif (isset($_GET['gems']))  $newGems += (int)$_GET['gems'];

$newCoins = max(0, $newCoins);
$newGems  = max(0, $newGems);

$pdo->prepare("UPDATE players SET coins=?, gems=?, last_seen=? WHERE id=?")
    ->execute([$newCoins, $newGems, time(), $id]);

$deltaCoins = $newCoins - (int)$player['coins'];
$deltaGems  = $newGems  - (int)$player['gems'];
if ($deltaCoins != 0 || $deltaGems != 0) {
    $pdo->prepare("INSERT INTO transactions (player_id,delta_coins,delta_gems,reason,match_id,created_at) VALUES (?,?,?,'admin_grant',?,?)")
        ->execute([$id, $deltaCoins, $deltaGems, 'admin_' . time(), time()]);
}

echo "<html><head><style>body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px}a{color:#3fb950}</style></head><body>";
echo "<h2 style='color:#3fb950'>Grant applied</h2>";
echo "<p>Player: <b>" . htmlspecialchars($player['display_name'] ?: $id) . "</b></p>";
echo "<p>Coins: {$player['coins']} &rarr; <b>$newCoins</b> (" . ($deltaCoins >= 0 ? "+$deltaCoins" : $deltaCoins) . ")</p>";
echo "<p>Gems: {$player['gems']} &rarr; <b>$newGems</b> (" . ($deltaGems >= 0 ? "+$deltaGems" : $deltaGems) . ")</p>";
echo "<p><a href='grant.php?list=1'>Back to player list</a></p>";
echo "</body></html>";
