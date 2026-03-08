<?php
// mail.php — player mailbox: fetch inbox + claim reward
// GET  ?action=inbox&player_id=X&token=Y  → list all mail (newest first)
// POST action=claim  player_id  token  mail_id  → claim a mail reward once

require __DIR__ . '/_db.php';

$method = $_SERVER['REQUEST_METHOD'];

// ── GET: fetch inbox ──────────────────────────────────────────────────────────
if ($method === 'GET') {
    $player = require_auth();   // reads player_id + token from GET, validates
    $pdo    = db();

    $q = $pdo->prepare(
        "SELECT id, subject, body, coins, gems, claimed, sent_at
           FROM player_mail
          WHERE player_id = ?
          ORDER BY id DESC
          LIMIT 50"
    );
    $q->execute([$player['id']]);
    $rows = $q->fetchAll();

    // Cast types so JSON encodes integers correctly
    foreach ($rows as &$r) {
        $r['id']      = (int)$r['id'];
        $r['coins']   = (int)$r['coins'];
        $r['gems']    = (int)$r['gems'];
        $r['claimed'] = (int)$r['claimed'];
        $r['sent_at'] = (int)$r['sent_at'];
    }
    unset($r);

    ok(['mail' => $rows]);
}

// ── POST: claim a mail item ───────────────────────────────────────────────────
if ($method === 'POST') {
    $action = trim($_POST['action'] ?? '');
    if ($action !== 'claim') fail('bad_action');

    $player  = require_auth();
    $mail_id = (int)($_POST['mail_id'] ?? 0);
    if ($mail_id <= 0) fail('missing mail_id');

    $pdo = db();

    $stmt = $pdo->prepare("SELECT * FROM player_mail WHERE id = ? AND player_id = ?");
    $stmt->execute([$mail_id, $player['id']]);
    $mail = $stmt->fetch();

    if (!$mail)             fail('not_found', 404);
    if ($mail['claimed'])   fail('already_claimed');

    $pdo->beginTransaction();
    try {
        $pdo->prepare("UPDATE player_mail SET claimed = 1 WHERE id = ?")
            ->execute([$mail_id]);

        if ($mail['coins'] > 0 || $mail['gems'] > 0) {
            $pdo->prepare("UPDATE players SET coins = coins + ?, gems = gems + ? WHERE id = ?")
                ->execute([(int)$mail['coins'], (int)$mail['gems'], $player['id']]);

            $pdo->prepare(
                "INSERT INTO transactions (player_id, delta_coins, delta_gems, reason, created_at)
                 VALUES (?, ?, ?, ?, ?)"
            )->execute([
                $player['id'],
                (int)$mail['coins'],
                (int)$mail['gems'],
                'mail_claim#' . $mail_id,
                time(),
            ]);
        }
        $pdo->commit();
    } catch (\Throwable $e) {
        $pdo->rollBack();
        fail('db_error');
    }

    $bal = $pdo->prepare("SELECT coins, gems FROM players WHERE id = ?");
    $bal->execute([$player['id']]);
    $b = $bal->fetch();
    ok(['coins' => (int)$b['coins'], 'gems' => (int)$b['gems']]);
}

fail('method_not_allowed', 405);
