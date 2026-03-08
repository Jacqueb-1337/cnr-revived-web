<?php
// content.php — public content manifest endpoint
// GET: returns the full list of enabled content items (maps, textures, data files)
// No authentication required — returns only enabled items, URLs are admin-controlled.

require_once '_db.php';

header('Content-Type: application/json');
header('Cache-Control: no-store');

if ($_SERVER['REQUEST_METHOD'] !== 'GET') {
    http_response_code(405);
    echo json_encode(['ok' => false, 'error' => 'Method not allowed']);
    exit;
}

$pdo = db();

$rows = $pdo->query(
    "SELECT id, type, name, url, base_scene, material_name, data_key
       FROM content_items
      WHERE enabled = 1
      ORDER BY type, sort_order ASC, created_at ASC"
)->fetchAll(PDO::FETCH_ASSOC);

$maps     = [];
$textures = [];
$data     = [];

foreach ($rows as $r) {
    switch ($r['type']) {
        case 'map':
            $maps[] = [
                'id'         => $r['id'],
                'name'       => $r['name'],
                'url'        => $r['url'],
                'base_scene' => $r['base_scene'] ?: 'FreeRun3_1',
            ];
            break;
        case 'texture':
            $textures[] = [
                'id'            => $r['id'],
                'material_name' => $r['material_name'],
                'url'           => $r['url'],
            ];
            break;
        case 'data':
            $data[] = [
                'id'  => $r['id'],
                'key' => $r['data_key'],
                'url' => $r['url'],
            ];
            break;
    }
}

// manifest_version is a hash of the content so clients know when to re-sync
$version = count($rows) > 0 ? substr(md5(json_encode($rows)), 0, 12) : '0';

echo json_encode([
    'ok'               => true,
    'manifest_version' => $version,
    'maps'             => $maps,
    'textures'         => $textures,
    'data'             => $data,
]);
