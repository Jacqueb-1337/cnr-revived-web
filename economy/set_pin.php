<?php
// set_pin.php
// POST player_id, token, pin (4-8 digits)
// Saves a PIN so the player can recover their account on a new device via claim.php

require __DIR__ . '/_db.php';

if ($_SERVER['REQUEST_METHOD'] !== 'POST') fail('POST only', 405);

$player    = require_auth();
$player_id = $player['id'];
$pin       = trim($_POST['pin'] ?? '');

if (!preg_match('/^\d{4,8}$/', $pin)) fail('pin must be 4-8 digits');

$hash = password_hash($player_id . $pin, PASSWORD_BCRYPT, ['cost' => 10]);
db()->prepare("UPDATE players SET pin_hash=? WHERE id=?")->execute([$hash, $player_id]);

ok(['message' => 'PIN set']);
