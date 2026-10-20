<?php
/* ============================================================
   send-order.php — обработчик заказов для хостинга Бегет
   Отправляет письмо через SMTP Mail.ru (порт 465, SSL)
   ============================================================ */

use PHPMailer\PHPMailer\PHPMailer;
use PHPMailer\PHPMailer\Exception;

// PHPMailer подключаем вручную — Composer на shared-хостинге не нужен
require __DIR__ . '/phpmailer/Exception.php';
require __DIR__ . '/phpmailer/PHPMailer.php';
require __DIR__ . '/phpmailer/SMTP.php';

// Куда приходят заказы
const RECIPIENT = 'otpechatok2026@mail.ru';

// Максимальная длина текстовых полей
const MAX_FIELD_LENGTH = 2000;

// Максимальный размер PDF после декодирования (15 МБ)
const MAX_PDF_BYTES = 15 * 1024 * 1024;

// Порог размера оригинального изображения: если больше — сжимаем через GD (5 МБ)
const MAX_IMG_BYTES = 5 * 1024 * 1024;

// Поля формы и их подписи в письме
$FIELDS = [
    'product_type' => 'Тип товара',
    'name'         => 'Имя',
    'phone'        => 'Телефон',
    'email'        => 'E-mail',
    'vk'           => 'ВКонтакте',
    'telegram'     => 'Telegram',
    'max'          => 'MAX',
    'color'        => 'Цвет футболки',
    'size'         => 'Размер',
    'sides'        => 'Стороны с принтом',
    'message'      => 'Комментарий',
];

// ── Ответ в формате JSON и завершение скрипта ────────────────────────────
function json_response($statusCode, array $body)
{
    http_response_code($statusCode);
    header('Content-Type: application/json; charset=utf-8');
    echo json_encode($body, JSON_UNESCAPED_UNICODE);
    exit;
}

// ── Привести значение к безопасной строке ограниченной длины ─────────────
function clean($value)
{
    if ($value === null || is_array($value) || is_object($value)) {
        return '';
    }
    return mb_substr(trim((string) $value), 0, MAX_FIELD_LENGTH, 'UTF-8');
}

// ── Экранирование HTML ───────────────────────────────────────────────────
function escape_html($text)
{
    return htmlspecialchars($text, ENT_QUOTES, 'UTF-8');
}

// ── Декодирует base64-изображение и при необходимости сжимает через GD ───
function decode_and_resize_image($base64Data)
{
    if (!is_string($base64Data) || $base64Data === '') {
        return false;
    }

    $base64Data = preg_replace('/\s+/', '', $base64Data);
    $binary = base64_decode($base64Data, true);
    if ($binary === false || strlen($binary) < 8) {
        return false;
    }

    if (strlen($binary) <= MAX_IMG_BYTES) {
        return $binary;
    }

    if (!function_exists('imagecreatefromstring')) {
        return $binary;
    }

    $src = @imagecreatefromstring($binary);
    if ($src === false) {
        return false;
    }

    $origW = imagesx($src);
    $origH = imagesy($src);
    $maxDim = 3000;

    if ($origW > $maxDim || $origH > $maxDim) {
        $ratio = min($maxDim / $origW, $maxDim / $origH);
        $newW  = max(1, (int)($origW * $ratio));
        $newH  = max(1, (int)($origH * $ratio));
    } else {
        $newW = $origW;
        $newH = $origH;
    }

    $dst = imagecreatetruecolor($newW, $newH);
    imagealphablending($dst, false);
    imagesavealpha($dst, true);
    imagecopyresampled($dst, $src, 0, 0, 0, 0, $newW, $newH, $origW, $origH);
    imagedestroy($src);

    ob_start();
    imagejpeg($dst, null, 90);
    imagedestroy($dst);
    return ob_get_clean();
}

// Принимаем только POST
if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    header('Allow: POST');
    json_response(405, ['ok' => false, 'error' => 'Метод не поддерживается']);
}

// ── Разбираем тело запроса ───────────────────────────────────────────────
$raw  = file_get_contents('php://input');
$data = json_decode($raw === false ? '' : $raw, true);
if (!is_array($data)) {
    $data = $_POST;
}
if (empty($data)) {
    json_response(400, ['ok' => false, 'error' => 'Некорректные данные запроса']);
}

// Ловушка для ботов
if (clean(isset($data['bot-field']) ? $data['bot-field'] : '') !== '') {
    json_response(200, ['ok' => true]);
}

// ── Собираем и проверяем поля ────────────────────────────────────────────
$order = [];
foreach ($FIELDS as $key => $label) {
    $order[$key] = clean(isset($data[$key]) ? $data[$key] : '');
}

$sides = [];
if (!empty($data['hasFront'])) $sides[] = 'перед';
if (!empty($data['hasBack']))  $sides[] = 'спина';
$order['sides'] = $sides ? implode(', ', $sides) : 'не указано';

if (mb_strlen($order['name'], 'UTF-8') < 2) {
    json_response(400, ['ok' => false, 'error' => 'Не указано имя']);
}
if (!preg_match('/^[\d\s+\-()]{7,}$/u', $order['phone'])) {
    json_response(400, ['ok' => false, 'error' => 'Некорректный телефон']);
}

// PDF приходит строкой base64
$pdfBinary = '';
if (isset($data['pdf']) && is_string($data['pdf']) && $data['pdf'] !== '') {
    $pdfBase64 = preg_replace('/\s+/', '', $data['pdf']);
    $pdfBinary = base64_decode($pdfBase64, true);
    if ($pdfBinary === false || strncmp($pdfBinary, '%PDF', 4) !== 0) {
        json_response(400, ['ok' => false, 'error' => 'Некорректный PDF-файл']);
    }
    if (strlen($pdfBinary) > MAX_PDF_BYTES) {
        json_response(413, ['ok' => false, 'error' => 'PDF-файл слишком большой']);
    }
}

// Декодируем ВСЕ оригинальные изображения с каждой стороны (массивы)
$frontImagesBinaries = [];
$backImagesBinaries  = [];

if (isset($data['originalImagesFront']) && is_array($data['originalImagesFront'])) {
    foreach ($data['originalImagesFront'] as $b64) {
        $bin = decode_and_resize_image($b64);
        if ($bin !== false && $bin !== '') {
            $frontImagesBinaries[] = $bin;
        }
    }
}
if (isset($data['originalImagesBack']) && is_array($data['originalImagesBack'])) {
    foreach ($data['originalImagesBack'] as $b64) {
        $bin = decode_and_resize_image($b64);
        if ($bin !== false && $bin !== '') {
            $backImagesBinaries[] = $bin;
        }
    }
}

// ── Текст письма ─────────────────────────────────────────────────────────
$textRows = [];
$htmlRows = '';
foreach ($FIELDS as $key => $label) {
    $value = $order[$key] !== '' ? $order[$key] : '—';
    $textRows[] = $label . ': ' . $value;
    $htmlRows  .= '<tr><td style="color:#666;vertical-align:top"><b>' . escape_html($label) . '</b></td>'
                . '<td style="white-space:pre-wrap">' . escape_html($value) . '</td></tr>';
}

$text = "Новый заказ с сайта «Отпечаток»\n\n" . implode("\n", $textRows)
      . ($pdfBinary !== '' ? "\n\nМакеты футболки — во вложении (PDF)." : '');

$html = '<h2>Новый заказ с сайта «Отпечаток»</h2>'
      . '<table cellpadding="6" style="border-collapse:collapse;font-family:Arial,sans-serif;font-size:14px">'
      . $htmlRows
      . '</table>'
      . ($pdfBinary !== '' ? '<p>Макеты футболки — во вложении (PDF).</p>' : '');

// ── Отправка через SMTP Mail.ru (SSL, порт 465) ──────────────────────────
$mail = new PHPMailer(true);

try {
    $mail->isSMTP();
    $mail->Host       = 'smtp.mail.ru';
    $mail->Port       = 465;
    $mail->SMTPSecure = PHPMailer::ENCRYPTION_SMTPS;
    $mail->SMTPAuth   = true;

    $mail->Username   = 'aidar.mukhitov@mail.ru';
    $mail->Password   = 'password';

    $mail->Timeout    = 20;
    $mail->CharSet    = PHPMailer::CHARSET_UTF8;

    $mail->setFrom('aidar.mukhitov@mail.ru', 'Отпечаток');
    $mail->addAddress(RECIPIENT);

    if (filter_var($order['email'], FILTER_VALIDATE_EMAIL)) {
        $mail->addReplyTo($order['email'], $order['name']);
    }

    $productLabel = $order['product_type'] !== '' ? '[' . $order['product_type'] . '] ' : '';
    $mail->Subject = $productLabel . 'Новый заказ: ' . $order['name'] . ', ' . $order['phone'];
    $mail->isHTML(true);
    $mail->Body    = $html;
    $mail->AltBody = $text;

        if ($pdfBinary !== '') {
        $mail->addStringAttachment($pdfBinary, 'order-' . date('Y-m-d') . '.pdf', PHPMailer::ENCODING_BASE64, 'application/pdf');
    }

    // Оригиналы: перед
    foreach ($frontImagesBinaries as $i => $bin) {
        $num = $i + 1;
        $mail->addStringAttachment($bin, "front-{$num}.jpg", PHPMailer::ENCODING_BASE64, 'image/jpeg');
    }
    // Оригиналы: спина
    foreach ($backImagesBinaries as $i => $bin) {
        $num = $i + 1;
        $mail->addStringAttachment($bin, "back-{$num}.jpg", PHPMailer::ENCODING_BASE64, 'image/jpeg');
    }

    $mail->send();
} catch (Exception $e) {
    error_log('send-order.php: ошибка отправки письма: ' . $mail->ErrorInfo);
    json_response(502, ['ok' => false, 'error' => 'Не удалось отправить письмо']);
}

json_response(200, ['ok' => true]);