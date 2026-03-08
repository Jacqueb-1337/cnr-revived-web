<?php
// balance.php
// POST or GET player_id, token
// Returns: coins, gems, display_name

require __DIR__ . '/_db.php';

$player = require_auth();
ok(['coins' => (int)$player['coins'], 'gems' => (int)$player['gems'], 'display_name' => $player['display_name']]);
