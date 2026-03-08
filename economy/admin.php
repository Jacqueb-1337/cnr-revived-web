<?php
// admin.php — full admin dashboard (protected by HTTP Basic Auth in .htaccess)
// Supports: player list, send mail, mail history, grant currency, recent transactions

require __DIR__ . '/_db.php';

$pdo    = db();
$flash  = '';
$flash_ok = true;

// ── Handle POST actions ───────────────────────────────────────────────────────
if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $act = trim($_POST['act'] ?? '');

    if ($act === 'send_mail') {
        $pid     = trim($_POST['player_id'] ?? '');
        $subject = trim($_POST['subject']   ?? '');
        $body    = trim($_POST['body']      ?? '');
        $coins   = (int)($_POST['coins']    ?? 0);
        $gems    = (int)($_POST['gems']     ?? 0);

        if ($subject === '') {
            $flash = 'Subject is required.'; $flash_ok = false;
        } elseif ($pid === '*') {
            // Global broadcast — insert a row for every registered player
            $all = $pdo->query("SELECT id FROM players")->fetchAll();
            $stmt = $pdo->prepare(
                "INSERT INTO player_mail (player_id, subject, body, coins, gems, claimed, sent_at)
                 VALUES (?, ?, ?, ?, ?, 0, ?)"
            );
            $now = time();
            foreach ($all as $p) {
                $stmt->execute([$p['id'], $subject, $body, max(0,$coins), max(0,$gems), $now]);
            }
            $flash = 'Global mail sent to ' . count($all) . ' players.';
        } elseif ($pid === '') {
            $flash = 'Select a player (or All Players).'; $flash_ok = false;
        } else {
            $row = $pdo->prepare("SELECT id FROM players WHERE id = ?");
            $row->execute([$pid]);
            if (!$row->fetch()) {
                $flash = 'Player not found.'; $flash_ok = false;
            } else {
                $pdo->prepare(
                    "INSERT INTO player_mail (player_id, subject, body, coins, gems, claimed, sent_at)
                     VALUES (?, ?, ?, ?, ?, 0, ?)"
                )->execute([$pid, $subject, $body, max(0, $coins), max(0, $gems), time()]);
                $flash = 'Mail sent to player ' . htmlspecialchars($pid) . '.';
            }
        }
    }

    if ($act === 'grant') {
        $pid   = trim($_POST['player_id'] ?? '');
        $coins = (int)($_POST['coins']    ?? 0);
        $gems  = (int)($_POST['gems']     ?? 0);
        $mode  = $_POST['mode'] ?? 'add';   // add | set

        $row = $pdo->prepare("SELECT id, display_name FROM players WHERE id = ?");
        $row->execute([$pid]);
        $player = $row->fetch();
        if (!$player) {
            $flash = 'Player not found.'; $flash_ok = false;
        } else {
            if ($mode === 'set') {
                $pdo->prepare("UPDATE players SET coins = ?, gems = ? WHERE id = ?")
                    ->execute([$coins, $gems, $pid]);
            } else {
                $pdo->prepare("UPDATE players SET coins = coins + ?, gems = gems + ? WHERE id = ?")
                    ->execute([$coins, $gems, $pid]);
            }
            $pdo->prepare(
                "INSERT INTO transactions (player_id, delta_coins, delta_gems, reason, created_at)
                 VALUES (?, ?, ?, 'admin_grant', ?)"
            )->execute([$pid, $coins, $gems, time()]);
            $flash = ($mode === 'set' ? 'Set' : 'Granted') . ' coins=' . $coins . ' gems=' . $gems
                   . ' to ' . htmlspecialchars($player['display_name']) . '.';
        }
    }
}

// ── Query data ────────────────────────────────────────────────────────────────
$total_players = (int)$pdo->query("SELECT COUNT(*) FROM players")->fetchColumn();
$total_tx      = (int)$pdo->query("SELECT COUNT(*) FROM transactions")->fetchColumn();
$total_mail    = (int)$pdo->query("SELECT COUNT(*) FROM player_mail")->fetchColumn();
$unread_mail   = (int)$pdo->query("SELECT COUNT(*) FROM player_mail WHERE claimed=0")->fetchColumn();

$players = $pdo->query(
    "SELECT id, display_name, coins, gems, last_seen FROM players ORDER BY last_seen DESC LIMIT 200"
)->fetchAll();

$recent_mail = $pdo->query("
    SELECT m.id, m.sent_at, m.subject, m.coins AS m_coins, m.gems AS m_gems,
           m.claimed, p.display_name
      FROM player_mail m JOIN players p ON p.id = m.player_id
     ORDER BY m.id DESC LIMIT 100
")->fetchAll();

$recent_tx = $pdo->query("
    SELECT t.created_at, p.display_name, t.delta_coins, t.delta_gems, t.reason
      FROM transactions t JOIN players p ON p.id = t.player_id
     ORDER BY t.id DESC LIMIT 100
")->fetchAll();

header('Content-Type: text/html; charset=utf-8');
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>CNR Economy Admin</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{font-family:monospace;background:#0d1117;color:#c9d1d9;padding:16px;font-size:13px}
h1{color:#58a6ff;margin-bottom:12px;font-size:18px}
h2{color:#3fb950;margin:18px 0 8px;font-size:14px;border-bottom:1px solid #21262d;padding-bottom:4px}
.stats{display:flex;gap:16px;flex-wrap:wrap;margin-bottom:16px}
.stat{background:#161b22;border:1px solid #30363d;border-radius:6px;padding:8px 14px;min-width:120px}
.stat span{display:block;color:#8b949e;font-size:11px}
.stat strong{color:#e6edf3;font-size:16px}
.flash{padding:8px 14px;border-radius:6px;margin-bottom:12px;font-weight:bold}
.flash.ok{background:#0d2a14;border:1px solid #3fb950;color:#3fb950}
.flash.err{background:#2d0d0d;border:1px solid #f85149;color:#f85149}
details{background:#161b22;border:1px solid #30363d;border-radius:6px;margin-bottom:16px}
details summary{padding:10px 14px;cursor:pointer;color:#58a6ff;font-weight:bold;user-select:none;list-style:none}
details summary::-webkit-details-marker{display:none}
details summary::before{content:'▶ ';font-size:10px}
details[open] summary::before{content:'▼ '}
.form-body{padding:12px 14px;border-top:1px solid #30363d}
.form-row{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin-bottom:8px}
.form-row label{color:#8b949e;min-width:90px;flex-shrink:0}
.form-row input,.form-row select,.form-row textarea{
  background:#0d1117;border:1px solid #30363d;border-radius:4px;
  color:#e6edf3;padding:5px 8px;flex:1;min-width:160px}
.form-row textarea{resize:vertical;min-height:60px}
button[type=submit]{background:#238636;border:1px solid #2ea043;border-radius:4px;
  color:#fff;padding:6px 18px;cursor:pointer;font-weight:bold}
button[type=submit]:hover{background:#2ea043}
.tabs{display:flex;gap:0;border-bottom:1px solid #30363d;margin-bottom:14px}
.tab{padding:8px 16px;cursor:pointer;color:#8b949e;border-bottom:2px solid transparent}
.tab.active{color:#58a6ff;border-color:#58a6ff}
.pane{display:none}.pane.active{display:block}
table{border-collapse:collapse;width:100%;margin-bottom:16px}
th,td{padding:5px 8px;text-align:left;border-bottom:1px solid #21262d}
th{color:#58a6ff;background:#161b22}
tr:hover{background:#161b22}
.pos{color:#3fb950}.neg{color:#f85149}
.claimed{color:#3fb950}.unclaimed{color:#e3a53a}
.action-btn{background:#21262d;border:1px solid #30363d;border-radius:4px;
  color:#c9d1d9;padding:3px 8px;cursor:pointer;font-size:11px}
.action-btn:hover{background:#30363d}
input[type=search]{background:#161b22;border:1px solid #30363d;border-radius:4px;
  color:#c9d1d9;padding:4px 8px;margin-bottom:8px;width:260px}
</style>
</head>
<body>
<h1>CNR Economy Admin</h1>

<?php if ($flash): ?>
<div class="flash <?= $flash_ok ? 'ok' : 'err' ?>"><?= $flash ?></div>
<?php endif; ?>

<div class="stats">
  <div class="stat"><span>Players</span><strong><?= $total_players ?></strong></div>
  <div class="stat"><span>Transactions</span><strong><?= $total_tx ?></strong></div>
  <div class="stat"><span>Mail sent</span><strong><?= $total_mail ?></strong></div>
  <div class="stat"><span>Unclaimed mail</span><strong><?= $unread_mail ?></strong></div>
</div>

<!-- ── Send Mail ─────────────────────────────────────────────────────────── -->
<details id="send-mail-box">
  <summary>Send Mail to Player</summary>
  <div class="form-body">
    <form method="POST">
      <input type="hidden" name="act" value="send_mail">
      <div class="form-row">
        <label>Player</label>
        <select name="player_id" id="mail-player" required style="max-width:300px">
          <option value="">— select a player —</option>
          <option value="*" style="color:#f85149;font-weight:bold">★ ALL PLAYERS (global broadcast)</option>
          <?php foreach ($players as $p): ?>
          <option value="<?= htmlspecialchars($p['id']) ?>">
            <?= htmlspecialchars($p['display_name']) ?> (<?= htmlspecialchars(substr($p['id'],0,8)) ?>…)
          </option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="form-row">
        <label>Subject</label>
        <input type="text" name="subject" maxlength="100" placeholder="You earned a reward!" required>
      </div>
      <div class="form-row">
        <label>Body</label>
        <textarea name="body" maxlength="500" placeholder="Thanks for participating in the event…"></textarea>
      </div>
      <div class="form-row">
        <label>Coins</label>
        <input type="number" name="coins" value="0" min="0" max="99999" style="max-width:100px">
        <label style="min-width:60px">Gems</label>
        <input type="number" name="gems"  value="0" min="0" max="9999"  style="max-width:100px">
      </div>
      <button type="submit">Send Mail</button>
    </form>
  </div>
</details>

<!-- ── Grant Currency ─────────────────────────────────────────────────────── -->
<details>
  <summary>Grant / Set Currency</summary>
  <div class="form-body">
    <form method="POST">
      <input type="hidden" name="act" value="grant">
      <div class="form-row">
        <label>Player</label>
        <select name="player_id" required style="max-width:300px">
          <option value="">— select a player —</option>
          <?php foreach ($players as $p): ?>
          <option value="<?= htmlspecialchars($p['id']) ?>">
            <?= htmlspecialchars($p['display_name']) ?> (<?= htmlspecialchars(substr($p['id'],0,8)) ?>…)
          </option>
          <?php endforeach; ?>
        </select>
      </div>
      <div class="form-row">
        <label>Coins</label>
        <input type="number" name="coins" value="0" min="-99999" max="99999" style="max-width:100px">
        <label style="min-width:60px">Gems</label>
        <input type="number" name="gems"  value="0" min="-9999"  max="9999"  style="max-width:100px">
      </div>
      <div class="form-row">
        <label>Mode</label>
        <select name="mode" style="max-width:120px">
          <option value="add">Add to balance</option>
          <option value="set">Set balance to</option>
        </select>
      </div>
      <button type="submit">Apply</button>
    </form>
  </div>
</details>

<!-- ── Tabs ──────────────────────────────────────────────────────────────── -->
<div class="tabs">
  <div class="tab active" onclick="showTab('players')">Players (<?= $total_players ?>)</div>
  <div class="tab" onclick="showTab('mail')">Mail Log (<?= $total_mail ?>)</div>
  <div class="tab" onclick="showTab('transactions')">Transactions</div>
</div>

<!-- Players tab -->
<div class="pane active" id="pane-players">
  <input type="search" id="player-search" placeholder="Search by name or ID…" oninput="filterTable('player-tbl',this.value)">
  <table id="player-tbl">
    <tr><th>Name</th><th>ID (first 8)</th><th>Coins</th><th>Gems</th><th>Last seen</th><th>Actions</th></tr>
    <?php foreach ($players as $p): ?>
    <tr>
      <td><?= htmlspecialchars($p['display_name']) ?></td>
      <td title="<?= htmlspecialchars($p['id']) ?>"><?= htmlspecialchars(substr($p['id'],0,8)) ?>…</td>
      <td><?= (int)$p['coins'] ?></td>
      <td><?= (int)$p['gems'] ?></td>
      <td><?= date('m-d H:i', (int)$p['last_seen']) ?></td>
      <td>
        <button class="action-btn" onclick="prefillMail('<?= htmlspecialchars($p['id'],ENT_QUOTES) ?>')">Mail</button>
        <button class="action-btn" onclick="copyId('<?= htmlspecialchars($p['id'],ENT_QUOTES) ?>')">Copy ID</button>
      </td>
    </tr>
    <?php endforeach; ?>
  </table>
</div>

<!-- Mail log tab -->
<div class="pane" id="pane-mail">
  <table>
    <tr><th>#</th><th>Sent</th><th>To</th><th>Subject</th><th>Coins</th><th>Gems</th><th>Status</th></tr>
    <?php foreach ($recent_mail as $m): ?>
    <tr>
      <td><?= (int)$m['id'] ?></td>
      <td><?= date('m-d H:i', (int)$m['sent_at']) ?></td>
      <td><?= htmlspecialchars($m['display_name']) ?></td>
      <td><?= htmlspecialchars($m['subject']) ?></td>
      <td class="<?= $m['m_coins'] > 0 ? 'pos' : '' ?>"><?= (int)$m['m_coins'] ?></td>
      <td class="<?= $m['m_gems']  > 0 ? 'pos' : '' ?>"><?= (int)$m['m_gems'] ?></td>
      <td class="<?= $m['claimed'] ? 'claimed' : 'unclaimed' ?>"><?= $m['claimed'] ? '✓ claimed' : 'pending' ?></td>
    </tr>
    <?php endforeach; ?>
  </table>
</div>

<!-- Transactions tab -->
<div class="pane" id="pane-transactions">
  <table>
    <tr><th>Time</th><th>Player</th><th>Coins</th><th>Gems</th><th>Reason</th></tr>
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
</div>

<script>
function showTab(name) {
  document.querySelectorAll('.tab').forEach((t,i)=>{
    t.classList.toggle('active', ['players','mail','transactions'][i]===name);
  });
  document.querySelectorAll('.pane').forEach(p=>{
    p.classList.toggle('active', p.id==='pane-'+name);
  });
}
function filterTable(id, q) {
  q = q.toLowerCase();
  document.querySelectorAll('#'+id+' tr:not(:first-child)').forEach(row=>{
    row.style.display = row.textContent.toLowerCase().includes(q) ? '' : 'none';
  });
}
function prefillMail(pid) {
  document.getElementById('mail-player').value = pid;
  document.getElementById('send-mail-box').open = true;
  document.getElementById('send-mail-box').scrollIntoView({behavior:'smooth'});
}
function copyId(id) {
  navigator.clipboard.writeText(id).then(()=>alert('Copied: '+id));
}
// Auto-open send mail box if flash was from a send_mail action
<?php if ($flash && $flash_ok && strpos($flash,'Mail sent') === 0): ?>
document.getElementById('send-mail-box').open = true;
<?php endif; ?>
</script>
</body>
</html>
