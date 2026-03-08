<?php
// claim.php
// POST player_id (new device's ANDROID_ID), display_name, pin
// Finds the account by display_name + PIN, transfers it to the new device_id,
// issues a new token and returns balance.
// The old device's token is invalidated.

require __DIR__ . '/_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$new_device_id = trim($_POST['player_id']    ?? '');
$display_name  = trim($_POST['display_name'] ?? '');
$pin           = trim($_POST['pin']          ?? '');

if ($new_device_id === '') fail('missing player_id');
if (!preg_match('/^[0-9a-f]{1,64}$/i', $new_device_id)) fail('invalid player_id');
if ($display_name === '') fail('missing display_name');
if (!preg_match('/^\d{4,8}$/', $pin)) fail('pin must be 4-8 digits');

$pdo = db();

// Find all accounts with this display name that have a PIN set
$stmt = $pdo->prepare("SELECT * FROM players WHERE display_name=? AND pin_hash IS NOT NULL");
$stmt->execute([$display_name]);
$candidates = $stmt->fetchAll();

$match = null;
foreach ($candidates as $c) {
    if (password_verify($c['id'] . $pin, $c['pin_hash'])) {
        $match = $c;
        break;
    }
}

if (!$match) fail('no account found with that name and PIN', 404);
if ($match['id'] === $new_device_id) fail('already on this device — use register.php instead');

// Transfer: update the account's player_id to the new device, issue new token
$new_token = bin2hex(random_bytes(32));
$now       = time();

$pdo->beginTransaction();
try {
    // Update all child rows first
    $pdo->prepare("UPDATE transactions SET player_id=? WHERE player_id=?")->execute([$new_device_id, $match['id']]);
    $pdo->prepare("UPDATE wheel_spins  SET player_id=? WHERE player_id=?")->execute([$new_device_id, $match['id']]);
    // Update the player row (change primary key by delete+insert to avoid FK issues)
    $pdo->prepare("DELETE FROM players WHERE id=?")->execute([$match['id']]);
    $pdo->prepare("
        INSERT INTO players (id,display_name,token,pin_hash,coins,gems,registered_at,last_seen)
        VALUES (?,?,?,?,?,?,?,?)
    ")->execute([
        $new_device_id,
        $match['display_name'],
        $new_token,
        $match['pin_hash'],
        $match['coins'],
        $match['gems'],
        $match['registered_at'],
        $now,
    ]);
    $pdo->commit();
} catch (Exception $e) {
    $pdo->rollBack();
    fail('db error: ' . $e->getMessage(), 500);
}

ok([
    'token'        => $new_token,
    'coins'        => (int)$match['coins'],
    'gems'         => (int)$match['gems'],
    'display_name' => $match['display_name'],
]);
