<?php
// admin.php  — simple read-only admin view (protect with HTTP basic auth in .htaccess!)
// Shows top players, recent transactions, and basic stats.

require __DIR__ . '/_db.php';

$pdo = db();

$total_players = $pdo->query("SELECT COUNT(*) FROM players")->fetchColumn();
$total_tx      = $pdo->query("SELECT COUNT(*) FROM transactions")->fetchColumn();

$top = $pdo->query("SELECT display_name, coins, gems, last_seen FROM players ORDER BY coins DESC LIMIT 50")->fetchAll();
$recent_tx = $pdo->query("
    SELECT t.created_at, p.display_name, t.delta_coins, t.delta_gems, t.reason
    FROM transactions t JOIN players p ON p.id=t.player_id
    ORDER BY t.id DESC LIMIT 100
")->fetchAll();

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html><head><meta charset="UTF-8"><title>CNR Economy Admin</title>
<style>
body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:20px}
h2{color:#3fb950}table{border-collapse:collapse;width:100%;margin-bottom:30px}
th,td{padding:6px 10px;text-align:left;border-bottom:1px solid #30363d}
th{color:#58a6ff}.pos{color:#3fb950}.neg{color:#f85149}
</style></head><body>
<h2>CNR Economy Admin</h2>
<p>Players: <?= (int)$total_players ?> &nbsp;|&nbsp; Transactions: <?= (int)$total_tx ?></p>

<h3>Top 50 players (by coins)</h3>
<table><tr><th>Name</th><th>Coins</th><th>Gems</th><th>Last seen</th></tr>
<?php foreach ($top as $r): ?>
<tr>
  <td><?= htmlspecialchars($r['display_name']) ?></td>
  <td><?= (int)$r['coins'] ?></td>
  <td><?= (int)$r['gems'] ?></td>
  <td><?= date('Y-m-d H:i', (int)$r['last_seen']) ?></td>
</tr>
<?php endforeach; ?>
</table>

<h3>Last 100 transactions</h3>
<table><tr><th>Time</th><th>Player</th><th>Coins</th><th>Gems</th><th>Reason</th></tr>
<?php foreach ($recent_tx as $r): ?>
<tr>
  <td><?= date('m-d H:i', (int)$r['created_at']) ?></td>
  <td><?= htmlspecialchars($r['display_name']) ?></td>
  <td class="<?= $r['delta_coins'] >= 0 ? 'pos' : 'neg' ?>"><?= (int)$r['delta_coins'] ?></td>
  <td class="<?= $r['delta_gems']  >= 0 ? 'pos' : 'neg' ?>"><?= (int)$r['delta_gems']  ?></td>
  <td><?= htmlspecialchars($r['reason']) ?></td>
</tr>
<?php endforeach; ?>
</table>
</body></html>
